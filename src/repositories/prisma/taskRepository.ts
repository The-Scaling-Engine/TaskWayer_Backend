import { Prisma, Task } from '@prisma/client';
import prisma from '../../config/prisma';
import {
  ITaskRepository,
  CreateTaskData,
  UpdateTaskData,
  FindManyPaginatedOptions,
  PaginatedTasksResult,
  TaskStatsResult,
  WorkloadTaskStats,
  MemberTaskFilterOptions,
} from '../interfaces';
import { isUUID } from '../../utils/compatibility';
import { buildSkip } from '../../utils/pagination';

export class PrismaTaskRepository implements ITaskRepository {

  // ─────────────────────────────────────────────────
  // SINGLE RECORD
  // ─────────────────────────────────────────────────

  async findById(id: string): Promise<Task | null> {
    return prisma.task.findUnique({ where: { id } });
  }

  /**
   * Hybrid lookup: supports both Prisma UUID and legacy MongoDB ObjectId.
   * During Phase 3 cut-over, frontend URLs may still contain Mongo _id strings.
   * This method ensures those requests resolve correctly without breaking.
   */
  async findByIdOrMongoId(id: string): Promise<Task | null> {
    if (isUUID(id)) {
      return prisma.task.findUnique({ where: { id } });
    }
    // Fallback: treat as mongoId (legacy Mongo _id hex string)
    return prisma.task.findUnique({ where: { mongoId: id } });
  }

  // ─────────────────────────────────────────────────
  // COLLECTION
  // ─────────────────────────────────────────────────

  async findByProfile(profileId: string): Promise<Task[]> {
    return prisma.task.findMany({ where: { profileId } });
  }

  /**
   * Production-grade paginated query with:
   * - Filtering  : status, priority, tag, search (case-insensitive)
   * - Sorting    : deadline | createdAt | priority | status | title, asc | desc
   * - Pagination : page + limit with safe bounds
   * - Transaction: count and data fetched in single $transaction to avoid drift
   */
  async findManyPaginated(options: FindManyPaginatedOptions): Promise<PaginatedTasksResult> {
    const { profileId, filter = {}, sort = {}, pagination = {}, scopeFilter } = options;

    // ── Pagination bounds ──
    const page  = Math.max(1, pagination.page  ?? 1);
    const limit = Math.min(50, Math.max(1, pagination.limit ?? 10));
    const skip  = buildSkip(page, limit);

    // ── Build WHERE clause ──
    const baseScope: Prisma.TaskWhereInput = scopeFilter ?? { profileId };

    const additionalFilters: Prisma.TaskWhereInput = {};

    if (filter.status) {
      additionalFilters.status = filter.status as Prisma.EnumTaskStatusFilter;
    }

    if (filter.priority) {
      additionalFilters.priority = filter.priority as Prisma.EnumTaskPriorityFilter;
    }

    if (filter.tag) {
      additionalFilters.tags = { has: filter.tag };
    }

    if (filter.search) {
      additionalFilters.title = {
        contains: filter.search,
        mode: 'insensitive',
      };
    }

    const where: Prisma.TaskWhereInput = {
      AND: [baseScope, additionalFilters],
    };

    // ── Build ORDER BY clause — stable with id tiebreaker ──
    const validSortFields = ['deadline', 'createdAt', 'priority', 'status', 'title'] as const;
    const sortField = validSortFields.includes(sort.sortBy as typeof validSortFields[number])
      ? sort.sortBy!
      : 'createdAt';

    const sortOrder: Prisma.SortOrder = sort.order === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
      { [sortField]: sortOrder },
      { id: sortOrder },
    ];

    // ── Execute count + rows in single transaction to avoid drift ──
    const [tasks, total] = await prisma.$transaction([
      prisma.task.findMany({ where, orderBy, skip, take: limit }),
      prisma.task.count({ where }),
    ]);

    return { tasks, total, page, limit };
  }

  // ─────────────────────────────────────────────────
  // WORKLOAD
  // ─────────────────────────────────────────────────

  async getMemberTasksInDepartment(
    profileId: string,
    departmentId: string,
    filter: MemberTaskFilterOptions,
    page: number,
    limit: number
  ): Promise<PaginatedTasksResult> {
    const skip = buildSkip(page, limit);
    const where: Prisma.TaskWhereInput = { profileId, departmentId };

    if (filter.status !== undefined) {
      where.status = filter.status;
    }
    if (filter.priority !== undefined) {
      where.priority = filter.priority;
    }
    if (filter.deadlineBefore !== undefined) {
      where.deadline = { lte: new Date(`${filter.deadlineBefore}T23:59:59.999Z`) };
    }

    const [tasks, total] = await prisma.$transaction([
      prisma.task.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: limit }),
      prisma.task.count({ where }),
    ]);

    return { tasks, total, page, limit };
  }

  async getWorkloadByMemberIds(
    memberIds: string[],
    departmentId: string
  ): Promise<Map<string, WorkloadTaskStats>> {
    if (memberIds.length === 0) return new Map();

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [statusGroups, overdueGroups, highPriorityGroups, nearDeadlineGroups] = await prisma.$transaction([
      prisma.task.groupBy({
        by: ['profileId', 'status'],
        where: { profileId: { in: memberIds }, departmentId },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['profileId'],
        where: { profileId: { in: memberIds }, departmentId, status: { not: 'done' }, deadline: { lt: now } },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['profileId'],
        where: { profileId: { in: memberIds }, departmentId, priority: 'high', status: { not: 'done' } },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['profileId'],
        where: { profileId: { in: memberIds }, departmentId, status: { not: 'done' }, deadline: { gte: now, lte: sevenDaysLater } },
        _count: { id: true },
      }),
    ]);

    const result = new Map<string, WorkloadTaskStats>();
    for (const id of memberIds) {
      result.set(id, { total: 0, todo: 0, doing: 0, done: 0, overdue: 0, highPriority: 0, nearDeadline: 0 });
    }

    for (const g of statusGroups) {
      const stats = result.get(g.profileId);
      if (stats === undefined) continue;
      const count = g._count.id;
      stats.total += count;
      if (g.status === 'todo')  stats.todo  = count;
      if (g.status === 'doing') stats.doing = count;
      if (g.status === 'done')  stats.done  = count;
    }

    for (const g of overdueGroups) {
      const stats = result.get(g.profileId);
      if (stats !== undefined) stats.overdue = g._count.id;
    }

    for (const g of highPriorityGroups) {
      const stats = result.get(g.profileId);
      if (stats !== undefined) stats.highPriority = g._count.id;
    }

    for (const g of nearDeadlineGroups) {
      const stats = result.get(g.profileId);
      if (stats !== undefined) stats.nearDeadline = g._count.id;
    }

    return result;
  }

  // ─────────────────────────────────────────────────
  // WRITE
  // ─────────────────────────────────────────────────

  async create(data: CreateTaskData): Promise<Task> {
    return prisma.task.create({ data });
  }

  async update(id: string, data: UpdateTaskData): Promise<Task> {
    return prisma.task.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.task.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────
  // AGGREGATION
  // ─────────────────────────────────────────────────

  async count(profileId: string): Promise<number> {
    return prisma.task.count({ where: { profileId } });
  }

  /**
   * Replaces MongoDB $group aggregation pipeline.
   * Groups tasks by status and returns counts per status + total.
   */
  async statsByStatus(profileId: string): Promise<TaskStatsResult> {
    const groups = await prisma.task.groupBy({
      by: ['status'],
      where: { profileId },
      _count: { status: true },
    });

    const result: TaskStatsResult = { total: 0, todo: 0, doing: 0, done: 0 };

    for (const g of groups) {
      const count = g._count.status;
      if (g.status === 'todo')  result.todo  = count;
      if (g.status === 'doing') result.doing = count;
      if (g.status === 'done')  result.done  = count;
      result.total += count;
    }

    return result;
  }
}
