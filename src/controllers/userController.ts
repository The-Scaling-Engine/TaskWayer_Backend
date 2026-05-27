import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';
import type { UpdateProfileInput } from '../schemas/userSchemas';

const profileSelect = {
  id:        true,
  email:     true,
  name:      true,
  username:  true,
  avatar:    true,
  jobTitle:  true,
  role:      true,
  status:    true,
  mongoId:   true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profile = await prisma.profile.findUnique({
      where:  { id: req.user!.prismaId },
      select: profileSelect,
    });

    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User no longer exists');
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        _id:       profile.mongoId,
        id:        profile.id,
        email:     profile.email,
        name:      profile.name,
        username:  profile.username,
        avatar:    profile.avatar,
        jobTitle:  profile.jobTitle,
        role:      profile.role,
        status:    profile.status,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        __v: 0,
      },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getProfile failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getMyMemberships = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const memberships = await prisma.departmentMember.findMany({
      where: { userId: req.user!.prismaId, status: 'ACTIVE' },
      include: { department: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });

    res.status(200).json({
      success: true,
      data: memberships.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
        department: {
          id: m.department.id,
          name: m.department.name,
          description: m.department.description,
        },
      })),
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getMyMemberships failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const searchUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Number(req.query.limit) || 8, 20);

    if (!q) {
      res.status(200).json({ success: true, data: { users: [] } });
      return;
    }

    const users = await prisma.profile.findMany({
      where: {
        status: { not: 'BANNED' },
        OR: [
          { name:  { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, name: true, avatar: true },
      take: limit,
      orderBy: { name: 'asc' },
    });

    res.status(200).json({ success: true, data: { users } });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'searchUsers failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, avatar, username, jobTitle } = res.locals.validated.body as UpdateProfileInput;

    if (email !== undefined) {
      const existing = await prisma.profile.findUnique({ where: { email } });
      if (existing && existing.id !== req.user!.prismaId) {
        sendError(res, req, 409, 'CONFLICT', 'Email is already in use by another account');
        return;
      }
    }

    if (username !== undefined) {
      const existing = await prisma.profile.findUnique({ where: { username } });
      if (existing && existing.id !== req.user!.prismaId) {
        sendError(res, req, 409, 'CONFLICT', 'Username is already taken');
        return;
      }
    }

    const profile = await prisma.profile.update({
      where: { id: req.user!.prismaId },
      data: {
        ...(name     !== undefined && { name }),
        ...(avatar   !== undefined && { avatar }),
        ...(email    !== undefined && { email }),
        ...(username !== undefined && { username }),
        ...(jobTitle !== undefined && { jobTitle }),
      },
      select: profileSelect,
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        _id:       profile.mongoId,
        id:        profile.id,
        email:     profile.email,
        name:      profile.name,
        username:  profile.username,
        avatar:    profile.avatar,
        jobTitle:  profile.jobTitle,
        role:      profile.role,
        status:    profile.status,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        __v: 0,
      },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'updateProfile failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
