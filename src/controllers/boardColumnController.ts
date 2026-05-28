import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as boardColumnService from '../services/boardColumnService';
import { ServiceError } from '../services/departmentService';
import { sendError, sendSuccess, codeFor } from '../utils/apiResponse';
import logger from '../config/logger';

// GET /api/projects/:id/columns
export const getColumns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const columns = await boardColumnService.getColumns(projectId, profileId);
    sendSuccess(res, 200, { count: columns.length, data: columns });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getColumns failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// POST /api/projects/:id/columns
export const createColumn = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const { name, color } = req.body as { name: string; color?: string };
    const column = await boardColumnService.createColumn(projectId, profileId, {
      name,
      ...(color !== undefined && { color }),
    });
    sendSuccess(res, 201, { message: 'Column created', data: column });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'createColumn failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/projects/:id/columns/reorder
export const reorderColumns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const profileId = req.user!.prismaId;
    const { orderedIds } = req.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds)) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'orderedIds must be an array');
      return;
    }
    await boardColumnService.reorderColumns(projectId, profileId, orderedIds);
    sendSuccess(res, 200, { message: 'Columns reordered' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'reorderColumns failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/projects/:id/columns/:columnId
export const updateColumn = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const columnId  = req.params['columnId'] as string;
    const profileId = req.user!.prismaId;
    const { name, color } = req.body as { name?: string; color?: string };
    const column = await boardColumnService.updateColumn(projectId, columnId, profileId, {
      ...(name  !== undefined && { name }),
      ...(color !== undefined && { color }),
    });
    sendSuccess(res, 200, { message: 'Column updated', data: column });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateColumn failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// DELETE /api/projects/:id/columns/:columnId
export const deleteColumn = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const columnId  = req.params['columnId'] as string;
    const profileId = req.user!.prismaId;
    await boardColumnService.deleteColumn(projectId, columnId, profileId);
    sendSuccess(res, 200, { message: 'Column deleted' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteColumn failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
