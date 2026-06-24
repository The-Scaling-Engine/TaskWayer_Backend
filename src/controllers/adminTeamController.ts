import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { getTeamOverviewStats } from '../services/adminTeamService';
import prisma from '../config/prisma';
import { sendError } from '../utils/apiResponse';
import logger from '../config/logger';

export const getTeamOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stats = await getTeamOverviewStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'getTeamOverview failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getTeamOverviewTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { profileId } = req.params as { profileId: string };

    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true },
    });

    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    const tasks = await prisma.task.findMany({
      where: { profileId: profile.id, parentTaskId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        deadline: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: tasks });
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'getTeamOverviewTasks failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
