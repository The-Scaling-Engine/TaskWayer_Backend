import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';
import * as boardColumnService from '../services/boardColumnService';
import { ServiceError } from '../services/departmentService';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';

const taskRepo = new PrismaTaskRepository();

// GET /api/projects/:id/board?limit=20
//
// Aggregates the kanban cold-start into one round-trip. The FE used to fire:
//   1. GET /projects/:id/columns
//   2. N × GET /tasks?columnId=... (one per column, after columns arrive)
// which is a 2-tier waterfall — the second wave can't start until the first
// resolves. This endpoint runs the two waves server-side against a warmer
// connection pool and returns everything the board needs to render.
export const getProjectBoard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const userId    = req.user!.id;
    const limit     = Math.min(Number(req.query['limit']) || 20, 100);

    // Reuse existing service so project-readability guard and default-column
    // seed logic keep applying — no duplicated business rules.
    const columns = await boardColumnService.getColumns(projectId, userId);

    if (columns.length === 0) {
      res.status(200).json({
        success: true,
        data: { columns: [], tasksByColumn: {} },
      });
      return;
    }

    const taskResults = await Promise.all(
      columns.map(async (col) => {
        const result = await taskRepo.findManyPaginated({
          profileId:  userId,
          filter:     { projectId, columnId: col.id },
          sort:       { sortBy: 'createdAt', order: 'desc' },
          pagination: { page: 1, limit },
        });
        return { columnId: col.id, result };
      })
    );

    const tasksByColumn: Record<string, { data: unknown; pagination: unknown }> = {};
    for (const { columnId, result } of taskResults) {
      const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
      tasksByColumn[columnId] = {
        data: result.tasks,
        pagination: {
          currentPage: result.page,
          totalPages,
          totalCount:  result.total,
          limit:       result.limit,
          hasNextPage: result.page < totalPages,
          hasPrevPage: result.page > 1,
        },
      };
    }

    res.status(200).json({
      success: true,
      data: { columns, tasksByColumn },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, 'SERVICE_ERROR', error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getProjectBoard failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
