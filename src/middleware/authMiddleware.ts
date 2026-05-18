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

    // Lazy-sync supabaseId on first login
    if (!profile.supabaseId) {
      prisma.profile.update({
        where: { id: profile.id },
        data:  { supabaseId: supabaseUser.id },
      }).catch(err => logger.warn({ err }, 'supabaseId lazy-sync failed'));
    }

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
