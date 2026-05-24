import { Task, Profile, RecurrenceType } from '@prisma/client';
import { generateRecurrenceDates } from '../utils/recurrence';
import { PrismaActivityLogRepository } from '../repositories/prisma/activityLogRepository';
import { resolveTaskPermission, TaskPermissionError } from '../utils/taskPermissions';
import * as realtimeService from './realtimeService';
import {
  ITaskRepository,
  IProfileRepository,
  IMembershipRepository,
  CreateTaskData,
  UpdateTaskData,
  TaskFilterOptions,
  TaskSortOptions,
  TaskPaginationOptions,
  TaskStatsResult,
} from '../repositories/interfaces';
import logger from '../config/logger';
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
  deadline?: string | null;
  scheduledAt?: string | null;
  departmentId?: string;
  assignedTo?: string;
  isRecurring?: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null;
  recurrenceEndDate?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: string | null;
  scheduledAt?: string | null;
  isRecurring?: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null;
  recurrenceEndDate?: string | null;
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
  deadlineFrom?:   string;
  deadlineTo?:     string;
  createdFrom?:    string;
  createdTo?:      string;
  scheduledFrom?:  string;
  scheduledTo?:    string;
  personal?:       boolean;
  assignedByMe?:   boolean;
  assignedToMe?:   boolean;
  departmentId?:   string;
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

    if (input.isRecurring) {
      if (!input.recurrenceType) {
        throw new TaskServiceError('recurrenceType is required for recurring tasks', 400);
      }
      if (!input.deadline) {
        throw new TaskServiceError('deadline is required for recurring tasks', 400);
      }
      if (input.recurrenceEndDate && new Date(input.recurrenceEndDate) <= new Date(input.deadline)) {
        throw new TaskServiceError('The recurrence end date must be later than the task deadline', 400);
      }
    }

    const initialStatus = input.status ?? 'todo';
    const completedNow  = initialStatus === 'done' ? new Date() : undefined;

    const task = await this.taskRepo.create({
      title:             input.title.trim(),
      description:       input.description ?? '',
      status:            initialStatus,
      priority:          input.priority ?? 'medium',
      tags:              input.tags     ?? [],
      profileId:         profile.id,
      scheduledAt:       input.scheduledAt ? new Date(input.scheduledAt) : new Date(),
      ...(input.deadline        != null && { deadline:        new Date(input.deadline) }),
      ...(input.departmentId    != null && { departmentId:    input.departmentId }),
      ...(input.assignedTo      != null && { assignedTo: input.assignedTo, assignedBy: profile.id, isAssigned: true }),
      ...(completedNow !== undefined    && { completedAt:     completedNow }),
      isRecurring:       input.isRecurring ?? false,
      ...(input.recurrenceType    != null && { recurrenceType:    input.recurrenceType as RecurrenceType }),
      ...(input.recurrenceEndDate != null && { recurrenceEndDate: new Date(input.recurrenceEndDate) }),
    });

    // Pre-generate all future instances so they appear on the calendar immediately
    if (task.isRecurring && task.scheduledAt && task.recurrenceType) {
      const futureDates = generateRecurrenceDates(
        task.scheduledAt,
        task.recurrenceType,
        task.recurrenceEndDate
      );

      const deadlineOffsetMs =
        task.deadline && task.scheduledAt
          ? task.deadline.getTime() - task.scheduledAt.getTime()
          : null;

      const instances: CreateTaskData[] = futureDates.map((scheduledDate) => {
        const deadline = deadlineOffsetMs !== null
          ? new Date(scheduledDate.getTime() + deadlineOffsetMs)
          : undefined;
        return {
          title:             task.title,
          description:       task.description,
          priority:          task.priority as 'low' | 'medium' | 'high',
          tags:              task.tags,
          profileId:         task.profileId,
          scheduledAt:       scheduledDate,
          ...(deadline !== undefined && { deadline }),
          ...(task.departmentId    && { departmentId: task.departmentId }),
          isRecurring:        true,
          recurrenceType:     task.recurrenceType!,
          recurrenceEndDate:  task.recurrenceEndDate,
          recurrenceParentId: task.id,
        };
      });

      if (instances.length > 0) {
        try {
          await this.taskRepo.createMany(instances);
        } catch (err) {
          // Compensating rollback: remove parent to avoid orphaned recurring task without instances
          await this.taskRepo.delete(task.id).catch((delErr: unknown) =>
            logger.error({ delErr, taskId: task.id }, 'createTask: parent rollback failed after createMany error')
          );
          throw err;
        }
      }
    }

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
    if (query.status)        filter.status        = query.status;
    if (query.priority)      filter.priority      = query.priority;
    if (query.search)        filter.search        = query.search;
    if (query.tag)           filter.tag           = query.tag;
    if (query.deadlineFrom)  filter.deadlineFrom  = query.deadlineFrom;
    if (query.deadlineTo)    filter.deadlineTo    = query.deadlineTo;
    if (query.createdFrom)    filter.createdFrom    = query.createdFrom;
    if (query.createdTo)      filter.createdTo      = query.createdTo;
    if (query.scheduledFrom)  filter.scheduledFrom  = query.scheduledFrom;
    if (query.scheduledTo)    filter.scheduledTo    = query.scheduledTo;
    if (query.personal)       filter.personal       = query.personal;
    if (query.assignedByMe)   filter.assignedByMe   = query.assignedByMe;
    if (query.assignedToMe)   filter.assignedToMe   = query.assignedToMe;
    if (query.departmentId)   filter.departmentId   = query.departmentId;

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

    if (task.isAssigned && task.assignedTo === profile.id) {
      const nonStatusKeys = (Object.keys(input) as (keyof UpdateTaskInput)[])
        .filter(k => k !== 'status' && input[k] !== undefined);
      if (nonStatusKeys.length > 0) {
        throw new TaskServiceError('Assigned task is read-only. Contact the manager to make changes.', 403);
      }
    }

    await this.resolveTaskPermission(task, profileId, profile, 'write');

    const data: UpdateTaskData = {};
    if (input.title             !== undefined) data.title             = input.title;
    if (input.description       !== undefined) data.description       = input.description;
    if (input.priority          !== undefined) data.priority          = input.priority;
    if (input.tags              !== undefined) data.tags              = input.tags;
    if (input.deadline          !== undefined) data.deadline          = input.deadline ? new Date(input.deadline) : null;
    if (input.scheduledAt       !== undefined) data.scheduledAt       = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (input.isRecurring       !== undefined) data.isRecurring       = input.isRecurring;
    if (input.recurrenceType    !== undefined) data.recurrenceType    = input.recurrenceType as RecurrenceType | null;
    if (input.recurrenceEndDate !== undefined) data.recurrenceEndDate = input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null;

    // completedAt is server-managed only — client cannot inject this value.
    // Transition: non-done → done sets it once; done → non-done clears it;
    // done → done preserves the original timestamp (no reset).
    const isCompletingNow = input.status === 'done' && task.status !== 'done';
    if (input.status !== undefined) {
      data.status = input.status;
      if (isCompletingNow) {
        data.completedAt = new Date();
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

  // ─── Cancel Recurrence ────────────────────────────────────────────────────

  async cancelRecurrence(
    profileId: string,
    taskId: string,
    keepChildren: boolean
  ): Promise<{ deletedCount: number }> {
    const task = await this.taskRepo.findByIdOrMongoId(taskId);
    if (!task) throw new TaskServiceError('Task not found', 404);
    if (!task.isRecurring) throw new TaskServiceError('Task is not recurring', 400);
    if (task.recurrenceParentId) throw new TaskServiceError('Use the parent task to cancel recurrence', 400);

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(task, profileId, profile, 'write');

    let deletedCount = 0;
    if (!keepChildren) {
      deletedCount = await this.taskRepo.deleteManyByParentId(task.id);
    }

    await this.taskRepo.update(task.id, {
      isRecurring: false,
      recurrenceType: null,
      recurrenceEndDate: null,
    });

    return { deletedCount };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async deleteTask(profileId: string, taskId: string): Promise<void> {
    const task = await this.taskRepo.findByIdOrMongoId(taskId);
    if (!task) {
      throw new TaskServiceError('Task not found', 404);
    }

    const profile = await this.resolveProfile(profileId);

    if (task.isAssigned && task.assignedTo === profile.id) {
      throw new TaskServiceError('Assigned task is read-only. Contact the manager to make changes.', 403);
    }

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
