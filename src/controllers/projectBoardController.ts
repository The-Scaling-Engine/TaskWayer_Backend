import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';
import * as boardColumnService from '../services/boardColumnService';
import { ServiceError } from '../services/departmentService';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { projectRepository } from '../repositories/prisma/projectRepository';
import { buildScopedTaskFilter } from '../utils/taskQueryBuilder';
import { mapPrismaTaskToResponseDTO } from '../dto/task/taskMapper';

const taskRepo       = new PrismaTaskRepository();
const membershipRepo = new PrismaMembershipRepository();

// Railway's pool is sized via DATABASE_URL `connection_limit` (currently 10).
// Running one query per column with an unbounded Promise.all would let a
// project with many columns saturate the whole pool by itself; cap how many
// column queries run concurrently so one board request can't starve others.
const COLUMN_QUERY_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

// GET /api/projects/:id/board?limit=20
//
// Aggregates the kanban cold-start into one round-trip. The FE used to fire:
//   1. GET /projects/:id/columns
//   2. N × GET /tasks?columnId=... (one per column, after columns arrive)
// which is a 2-tier waterfall — the second wave can't start until the first
// resolves. This endpoint runs the two waves server-side against a warmer
// connection pool and returns everything the board needs to render.
//
// Task rows are mapped through the same DTO the /tasks endpoint uses so the
// frontend (TaskCard, TaskDialog, etc.) can read `_id`, `userId`, `createdBy`,
// `subtaskProgress` etc. exactly like before.
//
// Scope is built with the same helper taskService.getTasks uses so the caller
// sees every task in the project they can already read — not just their own.
export const getProjectBoard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params['id'] as string;
    const userId    = req.user!.id;
    const limit     = Math.min(Number(req.query['limit']) || 20, 100);

    // Reuse existing service so project-readability guard + default-column
    // seed logic keep applying — no duplicated business rules.
    const columns = await boardColumnService.getColumns(projectId, userId);

    if (columns.length === 0) {
      res.status(200).json({
        success: true,
        data: { columns: [], tasksByColumn: {} },
      });
      return;
    }

    // Resolve the pieces the DTO mapper + scope builder need — one round-trip
    // each, shared across every per-column read below.
    const [viewerProfile, memberships, projectIds] = await Promise.all([
      prisma.profile.findUnique({
        where:  { id: userId },
        select: { id: true, mongoId: true, role: true, name: true, email: true, avatar: true },
      }),
      membershipRepo.findUserMemberships(userId),
      projectRepository.getProjectIdsForMember(userId),
    ]);

    if (!viewerProfile) {
      sendError(res, req, 401, 'UNAUTHORIZED', 'User profile not found');
      return;
    }

    const departmentIds = memberships.filter(m => m.status === 'ACTIVE').map(m => m.departmentId);
    const isGlobalAdmin = viewerProfile.role === 'ADMIN';
    const scopeFilter   = buildScopedTaskFilter(userId, departmentIds, projectIds, isGlobalAdmin);

    // Reads for each column run in parallel — each one respects the same scope
    // filter as GET /tasks so the board matches what /tasks?columnId=X returns.
    const taskResults = await mapWithConcurrency(columns, COLUMN_QUERY_CONCURRENCY, async (col) => {
      const result = await taskRepo.findManyPaginated({
        profileId:  userId,
        filter:     { projectId, columnId: col.id },
        sort:       { sortBy: 'createdAt', order: 'desc' },
        pagination: { page: 1, limit },
        scopeFilter,
      });
      return { columnId: col.id, result };
    });

    const tasksByColumn: Record<string, { data: unknown; pagination: unknown }> = {};
    for (const { columnId, result } of taskResults) {
      const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
      const dtoTasks = result.tasks.map((task) => {
        // The find included `profile: {...creatorProfileSelect}` so `task.profile`
        // here is the creator profile, not the viewer. Preserve the same override
        // taskService.getTasks does so `userId` in the DTO stays the viewer's
        // legacy mongoId (matches TaskCard expectations).
        const creatorProfile = (task as typeof task & { profile?: { name: string | null; email: string; avatar: string | null } | null }).profile;
        return mapPrismaTaskToResponseDTO(
          { ...task, profile: viewerProfile },
          creatorProfile ?? undefined,
        );
      });
      tasksByColumn[columnId] = {
        data: dtoTasks,
        pagination: {
          currentPage: result.page,
          totalPages,
          // Field name must match GET /tasks (`totalTasks`) — the FE Pagination
          // type reads only that key for column counts and load-more math.
          totalTasks:  result.total,
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
