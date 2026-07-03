import { Request, Response, NextFunction } from 'express';
import { Role, DepartmentMemberRole } from '@prisma/client';
import prisma from '../config/prisma';
import supabaseAdmin from '../config/supabase';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';

export interface AuthRequest extends Request {
  user?: {
    id:       string;
    prismaId: string;
    email:    string;
    role:     Role;
    departmentId?:   string | null;
    departmentRole?: DepartmentMemberRole | null;
  };
}

// ─── Token → user cache ──────────────────────────────────────────────
// Each protected request previously paid the full cost of Supabase.auth.getUser()
// (external HTTP round-trip) + a Prisma profile lookup. With a small TTL, bursts of
// requests from the same user (dashboard mount fires 5-6 requests in parallel)
// resolve from memory. Bans and role changes propagate within TTL_MS.

const TTL_MS   = 60_000;
const MAX_SIZE = 500;

interface CachedAuth {
  supabaseUserId: string;
  supabaseEmail:  string;
  profile: {
    id:         string;
    email:      string;
    role:       Role;
    status:     string;
    supabaseId: string | null;
  };
  expiresAt: number;
}

const authCache = new Map<string, CachedAuth>();

function readCache(token: string): CachedAuth | null {
  const entry = authCache.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    authCache.delete(token);
    return null;
  }
  return entry;
}

function writeCache(token: string, entry: Omit<CachedAuth, 'expiresAt'>): void {
  if (authCache.size >= MAX_SIZE) {
    // Simple FIFO eviction — oldest insertion goes first (Map iteration order)
    const oldest = authCache.keys().next().value;
    if (oldest) authCache.delete(oldest);
  }
  authCache.set(token, { ...entry, expiresAt: Date.now() + TTL_MS });
}

// Exported for tests / manual invalidation (e.g. after a ban action)
export function invalidateAuthCacheForToken(token: string): void {
  authCache.delete(token);
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn({ requestId: req.requestId, reason: 'no_token', path: req.originalUrl }, 'Auth rejected');
      sendError(res, req, 401, 'UNAUTHORIZED', 'Not authorized, no token provided');
      return;
    }

    const token = authHeader.slice(7);

    // ── Fast path: cache hit ────────────────────────────────────────
    const cached = readCache(token);
    if (cached) {
      if (cached.profile.status === 'BANNED') {
        logger.warn({ requestId: req.requestId, reason: 'banned', userId: cached.profile.id, path: req.originalUrl }, 'Auth rejected');
        sendError(res, req, 403, 'FORBIDDEN', 'Your account has been banned');
        return;
      }
      req.user = {
        id:       cached.profile.id,
        prismaId: cached.profile.id,
        email:    cached.profile.email,
        role:     cached.profile.role,
      };
      next();
      return;
    }

    // ── Slow path: verify with Supabase + fetch profile ─────────────
    const { data: { user: supabaseUser }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !supabaseUser || !supabaseUser.email) {
      logger.warn({ requestId: req.requestId, reason: 'invalid_token', path: req.originalUrl }, 'Auth rejected');
      sendError(res, req, 401, 'UNAUTHORIZED', 'Not authorized, token is invalid or expired');
      return;
    }

    const profile = await prisma.profile.findUnique({
      where:  { email: supabaseUser.email },
      select: { id: true, email: true, role: true, status: true, supabaseId: true },
    });

    if (!profile) {
      logger.warn({ requestId: req.requestId, reason: 'user_not_found', email: supabaseUser.email, path: req.originalUrl }, 'Auth rejected');
      sendError(res, req, 401, 'UNAUTHORIZED', 'Not authorized, user profile not found');
      return;
    }

    if (profile.status === 'BANNED') {
      logger.warn({ requestId: req.requestId, reason: 'banned', userId: profile.id, path: req.originalUrl }, 'Auth rejected');
      sendError(res, req, 403, 'FORBIDDEN', 'Your account has been banned');
      return;
    }

    // Auto-upgrade PENDING → ACTIVE on first successful login
    if (profile.status === 'PENDING') {
      prisma.profile.update({
        where: { id: profile.id },
        data:  { status: 'ACTIVE' },
      }).catch(err => logger.warn({ err }, 'PENDING→ACTIVE upgrade failed'));
    }

    // Lazy-sync supabaseId on first login
    if (!profile.supabaseId) {
      prisma.profile.update({
        where: { id: profile.id },
        data:  { supabaseId: supabaseUser.id },
      }).catch(err => logger.warn({ err }, 'supabaseId lazy-sync failed'));
    }

    // Populate cache for subsequent requests in this token's TTL window
    writeCache(token, {
      supabaseUserId: supabaseUser.id,
      supabaseEmail:  supabaseUser.email,
      profile,
    });

    req.user = {
      id:       profile.id,
      prismaId: profile.id,
      email:    profile.email,
      role:     profile.role,
    };

    next();
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'protect middleware error');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
