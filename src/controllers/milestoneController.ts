import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as milestoneService from '../services/milestoneService';
import { ServiceError } from '../services/departmentService';
import { sendError, sendSuccess, codeFor } from '../utils/apiResponse';
import logger from '../config/logger';

// GET /api/projects/:id/timeline
export const getTimeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const data = await milestoneService.getTimeline(projectId, profileId);
    sendSuccess(res, 200, data);
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getTimeline failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// GET /api/projects/:id/planning
export const getPlanningTree = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const skip = req.query['skip'] ? parseInt(req.query['skip'] as string, 10) : 0;
    const take = req.query['take'] ? parseInt(req.query['take'] as string, 10) : 50;
    const tree = await milestoneService.getPlanningTree(projectId, profileId, { skip, take });
    sendSuccess(res, 200, tree);
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getPlanningTree failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/projects/:id/milestones/:mid/tasks/reorder
export const reorderMilestoneTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId   = req.params['id'] as string;
    const milestoneId = req.params['mid'] as string;
    const profileId   = req.user!.prismaId;
    const { orderedIds } = req.body as { orderedIds: string[] };
    await milestoneService.reorderMilestoneTasks(projectId, milestoneId, profileId, orderedIds);
    sendSuccess(res, 200, { message: 'Tasks reordered' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'reorderMilestoneTasks failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// GET /api/projects/:id/milestones
export const getMilestones = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const milestones = await milestoneService.listMilestones(projectId, profileId);
    sendSuccess(res, 200, { count: milestones.length, data: milestones });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getMilestones failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// POST /api/projects/:id/milestones
export const createMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const { title, description, startDate, deadline } = req.body as {
      title: string;
      description?: string;
      startDate?: string | null;
      deadline?: string | null;
    };
    const milestone = await milestoneService.createMilestone(projectId, profileId, {
      title,
      ...(description !== undefined && { description }),
      ...(startDate   !== undefined && { startDate }),
      ...(deadline    !== undefined && { deadline }),
    });
    sendSuccess(res, 201, { message: 'Milestone created', data: milestone });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'createMilestone failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/projects/:id/milestones/reorder
export const reorderMilestones = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const { items } = req.body as { items: { id: string; order: number }[] };
    await milestoneService.reorderMilestones(projectId, profileId, items);
    sendSuccess(res, 200, { message: 'Milestones reordered' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'reorderMilestones failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/projects/:id/milestones/:mid
export const updateMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId   = req.params['id'] as string;
    const milestoneId = req.params['mid'] as string;
    const profileId   = req.user!.prismaId;
    const { title, description, startDate, deadline, status } = req.body as {
      title?:       string;
      description?: string | null;
      startDate?:   string | null;
      deadline?:    string | null;
      status?:      string;
    };
    const milestone = await milestoneService.updateMilestone(projectId, milestoneId, profileId, {
      ...(title       !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(startDate   !== undefined && { startDate }),
      ...(deadline    !== undefined && { deadline }),
      ...(status      !== undefined && { status }),
    });
    sendSuccess(res, 200, { message: 'Milestone updated', data: milestone });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateMilestone failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// DELETE /api/projects/:id/milestones/:mid
export const deleteMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId   = req.params['id'] as string;
    const milestoneId = req.params['mid'] as string;
    const profileId   = req.user!.prismaId;
    await milestoneService.deleteMilestone(projectId, milestoneId, profileId);
    sendSuccess(res, 200, { message: 'Milestone deleted' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteMilestone failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
