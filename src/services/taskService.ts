import { Task, Profile } from '@prisma/client';
import { PrismaActivityLogRepository } from '../repositories/prisma/activityLogRepository';
import { resolveTaskPermission, TaskPermissionError } from '../utils/taskPermissions';
import * as realtimeService from './realtimeService';
import {
  ITaskRepository,
  IProfileRepository,
  IMembershipRepository,
  UpdateTaskData,
  TaskFilterOptions,
  TaskSortOptions,
  TaskPaginationOptions,
  TaskStatsResult,
} from '../repositories/interfaces';
import { buildScopedTaskFilter } from '../utils/taskQueryBuilder';
import { mapPrismaTaskToResponseDTO } from '../dto/task/taskMapper';
import { TaskResponseDTO } from '../dto/task/taskResponse.dto';
import { PaginatedTasksResponseDTO, PaginationDTO } from '../dto/task/pagination.dto';

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: Date | null;
  departmentId?: string;
  isRecurring?: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  recurrenceEndDate?: Date | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: Date | null;
  recurrenceEndDate?: Date | null;
}

export interface GetTasksInput {
  status?: string;
  priority?: string;
  search?: string;
  tag?: string;
  page?: number;
  limit?: number;
  sortBy?: 'deadline' | 'createdAt' | 'priority' | 'status' | 'title';
  order?: 'asc' | 'desc';
  deadlineFrom?: Date;
  deadlineTo?: Date;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class TaskServiceError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

const activityLogRepo = new PrismaActivityLogRepository();

export class TaskService {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly profileRepo: IProfileRepository,
    private readonly membershipRepo: IMembershipRepository
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async resolveProfile(profileId: string): Promise<Profile> {
    if (!profileId) {
      throw new TaskServiceError('Invalid user identity', 401);
    }

    const profile = await this.profileRepo.findById(profileId);

    if (!profile) {
      throw new TaskServiceError('User profile not found', 404);
    }

    return profile;
  }

  private async resolveTaskPermission(
    task: Task,
    profileId: string,
    profile: Profile,
    level: 'read' | 'write' | 'delete'
  ): Promise<void> {
    try {
      await resolveTaskPermission(task, profileId, profile, level, this.membershipRepo);
    } catch (err) {
      if (err instanceof TaskPermissionError) {
        throw new TaskServiceError(err.message, err.statusCode);
      }
      throw err;
    }
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async createTask(profileId: string, input: CreateTaskInput): Promise<TaskResponseDTO> {
    if (!input.title?.trim()) {
      throw new TaskServiceError('Title is required', 400);
    }

    const profile = await this.resolveProfile(profileId);

    if (input.departmentId) {
      const membership = await this.membershipRepo.findByUserAndDepartment(
        profileId,
        input.departmentId
      );

      if (!membership || membership.status !== 'ACTIVE') {
        throw new TaskServiceError('You are not a member of this department', 403);
      }

      if (membership.role === 'VIEWER') {
        throw new TaskServiceError('VIEWER cannot create tasks', 403);
      }
    }

    const initialStatus = input.status ?? 'todo';
    const completedNow  = initialStatus === 'done' ? new Date() : undefined;

    const task = await this.taskRepo.create({
      title:       input.title.trim(),
      description: input.description ?? '',
      status:      initialStatus,
      priority:    input.priority    ?? 'medium',
      tags:        input.tags        ?? [],
      profileId:   profile.id,
      ...(input.deadline     != null && { deadline:     input.deadline }),
      ...(input.departmentId != null && { departmentId: input.departmentId }),
      ...(completedNow !== undefined  && { completedAt:  completedNow }),
    });

    return mapPrismaTaskToResponseDTO({ ...task, profile });
  }

  // ─── Read (list) ──────────────────────────────────────────────────────────

  async getTasks(profileId: string, query: GetTasksInput): Promise<PaginatedTasksResponseDTO> {
    const profile       = await this.resolveProfile(profileId);
    const isGlobalAdmin = profile.role === 'ADMIN';

    const memberships  = await this.membershipRepo.findUserMemberships(profileId);
    const departmentIds = memberships
      .filter(m => m.status === 'ACTIVE')
      .map(m => m.departmentId);

    const scopeFilter = buildScopedTaskFilter(profileId, departmentIds, isGlobalAdmin);

    if (query.status && !['todo', 'doing', 'done'].includes(query.status)) {
      throw new TaskServiceError('Invalid status. Must be: todo, doing, or done', 400);
    }

    if (query.priority && !['low', 'medium', 'high'].includes(query.priority)) {
      throw new TaskServiceError('Invalid priority. Must be: low, medium, or high', 400);
    }

    const filter: TaskFilterOptions = {};
    if (query.status)   filter.status   = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.search)   filter.search   = query.search;
    if (query.tag)      filter.tag      = query.tag;

    const sort: TaskSortOptions = {};
    if (query.sortBy) sort.sortBy = query.sortBy;
    if (query.order)  sort.order  = query.order;

    const paginationOpts: TaskPaginationOptions = {};
    if (query.page)  paginationOpts.page  = query.page;
    if (query.limit) paginationOpts.limit = query.limit;

    const result = await this.taskRepo.findManyPaginated({
      profileId:  profile.id,
      filter,
      sort,
      pagination: paginationOpts,
      scopeFilter,
    });

    const totalPages = Math.ceil(result.total / result.limit);

    const pagination: PaginationDTO = {
      currentPage: result.page,
      totalPages,
      totalTasks:  result.total,
      limit:       result.limit,
      hasNextPage: result.page < totalPages,
      hasPrevPage: result.page > 1,
    };

    const data = result.tasks.map(task => mapPrismaTaskToResponseDTO({ ...task, profile }));

    return { success: true, count: data.length, pagination, data };
  }

  // ─── Read (single) ────────────────────────────────────────────────────────

  async getTaskById(profileId: string, taskId: string): Promise<TaskResponseDTO> {
    const task = await this.taskRepo.findByIdOrMongoId(taskId);
    if (!task) {
      throw new TaskServiceError('Task not found', 404);
    }

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(task, profileId, profile, 'read');

    return mapPrismaTaskToResponseDTO({ ...task, profile });
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async updateTask(
    profileId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<TaskResponseDTO> {
    const task = await this.taskRepo.findByIdOrMongoId(taskId);
    if (!task) {
      throw new TaskServiceError('Task not found', 404);
    }

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(task, profileId, profile, 'write');

    const data: UpdateTaskData = {};
    if (input.title       !== undefined) data.title       = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priority    !== undefined) data.priority    = input.priority;
    if (input.tags        !== undefined) data.tags        = input.tags;
    if (input.deadline    !== undefined) data.deadline    = input.deadline;

    // completedAt is server-managed only — client cannot inject this value.
    // Transition: non-done → done sets it once; done → non-done clears it;
    // done → done preserves the original timestamp (no reset).
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'done' && task.status !== 'done') {
        const completedNow = new Date();
        data.completedAt = completedNow;
      } else if (input.status !== 'done') {
        data.completedAt = null;
      }
      // done → done: completedAt not added to data, Prisma leaves it unchanged
    }

    const updated = await this.taskRepo.update(task.id, data);

    // Emit realtime to all subscribers of this task room
    realtimeService.emitTaskUpdated(task.id, {
      taskId: task.id,
      departmentId: task.departmentId,
      updatedFields: Object.keys(data),
      updatedAt: updated.updatedAt,
    });

    return mapPrismaTaskToResponseDTO({ ...updated, profile });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getTaskStats(profileId: string): Promise<TaskStatsResult> {
    const profile = await this.resolveProfile(profileId);
    return this.taskRepo.statsByStatus(profile.id);
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async deleteTask(profileId: string, taskId: string): Promise<void> {
    const task = await this.taskRepo.findByIdOrMongoId(taskId);
    if (!task) {
      throw new TaskServiceError('Task not found', 404);
    }

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(task, profileId, profile, 'delete');

    await this.taskRepo.delete(task.id);

    if (task.departmentId) {
      void activityLogRepo.create({
        actorUserId: profileId,
        departmentId: task.departmentId,
        entityType: 'task',
        entityId: task.id,
        action: 'task.deleted',
        metadata: { title: task.title, ownerId: task.profileId },
      });
    }
  }
}
