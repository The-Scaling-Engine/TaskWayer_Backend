import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { prisma } from '../config/prisma';
import supabaseAdmin from '../config/supabase';
import { env } from '../config/env';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';
import type { GetUsersQuery, CreateUserInput } from '../schemas/adminSchemas';

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalUsers, bannedUsers, totalTasks] = await Promise.all([
      prisma.profile.count(),
      prisma.profile.count({ where: { status: 'BANNED' } }),
      prisma.task.count(),
    ]);

    res.status(200).json({ success: true, data: { totalUsers, bannedUsers, totalTasks } });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getDashboard failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, search } = res.locals.validated.query as GetUsersQuery;
    const skip = (page - 1) * limit;

    const where = search !== undefined
      ? { email: { contains: search, mode: 'insensitive' as const } }
      : {};

    const [totalUsers, profiles] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        select: {
          id:        true,
          mongoId:   true,
          email:     true,
          name:      true,
          username:  true,
          jobTitle:  true,
          role:      true,
          status:    true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const users = profiles.map(p => ({
      _id:       p.mongoId,
      id:        p.id,
      email:     p.email,
      name:      p.name,
      username:  p.username,
      jobTitle:  p.jobTitle,
      role:      p.role,
      status:    p.status,
      createdAt: p.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages:  Math.ceil(totalUsers / limit),
          totalUsers,
          limit,
        },
      },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getUsers failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const banUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userIdToBan = req.params['id'] as string;

    if (userIdToBan === req.user!.prismaId) {
      sendError(res, req, 403, 'FORBIDDEN', 'Admin cannot ban themselves');
      return;
    }

    const profile = await prisma.profile.findUnique({ where: { id: userIdToBan } });
    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    await prisma.profile.update({ where: { id: profile.id }, data: { status: 'BANNED' } });

    res.status(200).json({
      success: true,
      message: 'User has been banned',
      data: { _id: profile.mongoId, id: profile.id, email: profile.email, status: 'BANNED' },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'banUser failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const unbanUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userIdToUnban = req.params['id'] as string;

    const profile = await prisma.profile.findUnique({ where: { id: userIdToUnban } });
    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    await prisma.profile.update({ where: { id: profile.id }, data: { status: 'ACTIVE' } });

    res.status(200).json({
      success: true,
      message: 'User has been unbanned',
      data: { _id: profile.mongoId, id: profile.id, email: profile.email, status: 'ACTIVE' },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'unbanUser failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  let supabaseUserId: string | null = null;

  try {
    const { name, username, email } = res.locals.validated.body as CreateUserInput;

    // Check uniqueness in our DB
    const existing = await prisma.profile.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true, username: true },
    });
    if (existing?.email === email) {
      sendError(res, req, 409, 'CONFLICT', 'Email already in use');
      return;
    }
    if (existing?.username === username) {
      sendError(res, req, 409, 'CONFLICT', 'Username already in use');
      return;
    }

    // Invite via Supabase — Supabase handles email delivery to any address
    const { data, error: supabaseError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data:       { name, username },
      redirectTo: `${env.CLIENT_URL}/reset-password`,
    });

    if (supabaseError || !data.user) {
      logger.error({ err: supabaseError, email }, 'Supabase inviteUserByEmail failed');
      sendError(res, req, 500, 'INTERNAL_ERROR', 'Failed to send invitation email. Please try again.');
      return;
    }

    supabaseUserId = data.user.id;

    // Create Profile in our DB
    const profile = await prisma.profile.create({
      data: {
        email,
        name,
        username,
        supabaseId: supabaseUserId,
        role:   'USER',
        status: 'ACTIVE',
      },
    });

    logger.info({ adminId: req.user!.prismaId, newUserId: profile.id, email }, 'Admin created new user');

    res.status(201).json({
      success: true,
      message: 'User account created. An activation email has been sent.',
      data: {
        id:        profile.id,
        name:      profile.name,
        username:  profile.username,
        email:     profile.email,
        role:      profile.role,
        status:    profile.status,
        createdAt: profile.createdAt,
      },
    });
  } catch (error) {
    if (supabaseUserId) await supabaseAdmin.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    logger.error({ err: error, requestId: req.requestId }, 'createUser failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
