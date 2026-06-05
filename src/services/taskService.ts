import { Task, Profile, RecurrenceType } from '@prisma/client';
import { generateRecurrenceDates } from '../utils/recurrence';
import { PrismaActivityLogRepository } from '../repositories/prisma/activityLogRepository';
import { resolveTaskPermission, TaskPermissionError } from '../utils/taskPermissions';
import * as realtimeService from './realtimeService';
import { checkAndUpdateCompletion } from './milestoneService';
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
import { projectRepository, ProjectMemberRole } from '../repositories/prisma/projectRepository';
import * as notificationService from './notificationService';

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: string | null;
  scheduledAt?: string | null;
  projectId?: string;
  columnId?: string;
  assignedTo?: string;
  isRecurring?: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | null;
  recurrenceInterval?: number | null;
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
  columnId?: string | null;
  isRecurring?: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | null;
  recurrenceInterval?: number | null;
  recurrenceEndDate?: string | null;
  assignedTo?: string | null;
  milestoneId?: string | null;
  milestoneOrder?: number | null;
}

export interface CreateSubtaskInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: string | null;
}

export interface UpdateSubtaskInput {
  title?: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: string | null;
}

export interface BulkCreateInput {
  projectId?: string;
  columnId?: string | null;
  priority?: 'low' | 'medium' | 'high';
  tasks: Array<{
    title: string;
    priority?: 'low' | 'medium' | 'high';
  }>;
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
  projectId?:      string;
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

    if (input.projectId) {
      const projectMember = await projectRepository.getMember(input.projectId, profileId);
      if (!projectMember) {
        throw new TaskServiceError('You are not a member of this project', 403);
      }
      if (projectMember.role === ProjectMemberRole.VIEWER) {
        throw new TaskServiceError('VIEWER cannot create tasks in this project', 403);
      }
      const project = await projectRepository.findById(input.projectId, true);
      if (project?.archivedAt) {
        throw new TaskServiceError('Cannot create tasks in an archived project', 400);
      }
    }

    if (input.isRecurring) {
      if (!input.recurrenceType) {
        throw new TaskServiceError('recurrenceType is required for recurring tasks', 400);
      }
      if (input.deadline && input.recurrenceEndDate && new Date(input.recurrenceEndDate) <= new Date(input.deadline)) {
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
      ...(input.projectId       != null && { projectId:       input.projectId }),
      ...(input.columnId        != null && { columnId:        input.columnId }),
      ...(input.assignedTo      != null && { assignedTo: input.assignedTo, assignedBy: profile.id }),
      ...(completedNow !== undefined    && { completedAt:     completedNow }),
      isRecurring:       input.isRecurring ?? false,
      ...(input.recurrenceType     != null && { recurrenceType:     input.recurrenceType as RecurrenceType }),
      ...(input.recurrenceInterval != null && { recurrenceInterval: input.recurrenceInterval }),
      ...(input.recurrenceEndDate  != null && { recurrenceEndDate:  new Date(input.recurrenceEndDate) }),
    });

    // Pre-generate all future instances so they appear on the calendar immediately
    if (task.isRecurring && task.scheduledAt && task.recurrenceType) {
      const futureDates = generateRecurrenceDates(
        task.scheduledAt,
        task.recurrenceType,
        task.recurrenceEndDate,
        task.recurrenceInterval
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
          ...(task.projectId      && { projectId:    task.projectId }),
          isRecurring:         true,
          recurrenceType:      task.recurrenceType!,
          ...(task.recurrenceInterval != null && { recurrenceInterval: task.recurrenceInterval }),
          recurrenceEndDate:   task.recurrenceEndDate,
          recurrenceParentId:  task.id,
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

    return mapPrismaTaskToResponseDTO({ ...task, profile }, { name: profile.name, email: profile.email, avatar: profile.avatar });
  }

  // ─── Bulk Create ─────────────────────────────────────────────────────────

  async bulkCreate(
    profileId: string,
    input: BulkCreateInput
  ): Promise<{ count: number; tasks: TaskResponseDTO[] }> {
    const profile = await this.resolveProfile(profileId);

    const validItems = input.tasks.filter(t => t.title.trim().length > 0);
    if (validItems.length === 0) {
      throw new TaskServiceError('No valid tasks to create (all titles are blank)', 400);
    }

    if (input.projectId) {
      const projectMember = await projectRepository.getMember(input.projectId, profileId);
      if (!projectMember) {
        throw new TaskServiceError('You are not a member of this project', 403);
      }
      if (projectMember.role === ProjectMemberRole.VIEWER) {
        throw new TaskServiceError('VIEWER cannot create tasks in this project', 403);
      }
    }

    const now = new Date();
    const dataItems: CreateTaskData[] = validItems.map(item => ({
      title:       item.title.trim(),
      description: '',
      status:      'todo',
      priority:    item.priority ?? input.priority ?? 'medium',
      tags:        [],
      profileId:   profile.id,
      scheduledAt: now,
      ...(input.projectId && { projectId: input.projectId }),
      ...(input.columnId  && { columnId:  input.columnId }),
    }));

    const created = await this.taskRepo.bulkCreate(dataItems);

    const dtos = created.map(task =>
      mapPrismaTaskToResponseDTO(
        { ...task, profile },
        { name: profile.name, email: profile.email, avatar: profile.avatar }
      )
    );

    return { count: created.length, tasks: dtos };
  }

  // ─── Read (list) ──────────────────────────────────────────────────────────

  async getTasks(profileId: string, query: GetTasksInput): Promise<PaginatedTasksResponseDTO> {
    const profile       = await this.resolveProfile(profileId);
    const isGlobalAdmin = profile.role === 'ADMIN';

    const memberships  = await this.membershipRepo.findUserMemberships(profileId);
    const departmentIds = memberships
      .filter(m => m.status === 'ACTIVE')
      .map(m => m.departmentId);

    const projectIds = await projectRepository.getProjectIdsForMember(profileId);

    const scopeFilter = buildScopedTaskFilter(profileId, departmentIds, projectIds, isGlobalAdmin);

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
    if (query.projectId) {
      const projectMember = await projectRepository.getMember(query.projectId, profileId);
      if (!projectMember && !isGlobalAdmin) {
        throw new TaskServiceError('You are not a member of this project', 403);
      }
      filter.projectId = query.projectId;
    }

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

    const data = result.tasks.map(task => {
      const taskWithCreator = task as typeof task & { profile?: { mongoId: string | null; name: string | null; email: string; avatar: string | null } | null };
      const creatorProfile = taskWithCreator.profile;
      return mapPrismaTaskToResponseDTO({ ...task, profile }, creatorProfile);
    });

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

    const taskWithCreator = task as typeof task & { profile?: { mongoId: string | null; name: string | null; email: string; avatar: string | null } | null };
    return mapPrismaTaskToResponseDTO({ ...task, profile }, taskWithCreator.profile);
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

    // Fetch project membership once — reused for assignedTo + milestoneId checks below
    const projectMember = (task.projectId && (input.assignedTo !== undefined || input.milestoneId !== undefined))
      ? await projectRepository.getMember(task.projectId, profileId)
      : null;

    // ── Assignment field-level permission ──────────────────────
    if (input.assignedTo !== undefined && task.projectId) {
      const callerRole = projectMember?.role;
      const isManagerOrOwner = callerRole === ProjectMemberRole.MANAGER || callerRole === ProjectMemberRole.OWNER;
      const isOrgAdmin = profile.role === 'ADMIN';
      const isMember = callerRole === ProjectMemberRole.MEMBER;

      if (!isManagerOrOwner && !isOrgAdmin) {
        if (isMember) {
          // MEMBER can only self-assign or unassign
          if (input.assignedTo !== null && input.assignedTo !== profileId) {
            throw new TaskServiceError('MEMBER can only assign to themselves or leave unassigned', 403);
          }
        } else {
          throw new TaskServiceError('Only MANAGER or OWNER can assign tasks', 403);
        }
      }

      if (input.assignedTo !== null) {
        const memberIds = await projectRepository.getMemberIds(task.projectId);
        if (!memberIds.includes(input.assignedTo)) {
          throw new TaskServiceError('Assignee must be a project member', 400);
        }
      }
    }

    const data: UpdateTaskData = {};
    if (input.title             !== undefined) data.title             = input.title;
    if (input.description       !== undefined) data.description       = input.description;
    if (input.priority          !== undefined) data.priority          = input.priority;
    if (input.tags              !== undefined) data.tags              = input.tags;
    if (input.deadline          !== undefined) data.deadline          = input.deadline ? new Date(input.deadline) : null;
    if (input.scheduledAt       !== undefined) data.scheduledAt       = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (input.columnId          !== undefined) data.columnId          = input.columnId ?? null;
    if (input.isRecurring       !== undefined) data.isRecurring       = input.isRecurring;
    if (input.recurrenceType     !== undefined) data.recurrenceType     = input.recurrenceType as RecurrenceType | null;
    if (input.recurrenceInterval !== undefined) data.recurrenceInterval = input.recurrenceInterval ?? null;
    if (input.recurrenceEndDate  !== undefined) data.recurrenceEndDate  = input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null;

    // Atomic assignment update — always set all three fields together
    if (input.assignedTo !== undefined) {
      if (input.assignedTo !== null) {
        data.assignedTo  = input.assignedTo;
        data.assignedBy  = profileId;
      } else {
        data.assignedTo  = null;
        data.assignedBy  = null;
      }
    }

    // milestoneId — OWNER/MANAGER only
    if (input.milestoneId !== undefined && task.projectId) {
      const callerRole = projectMember?.role;
      const isManagerOrOwner = callerRole === ProjectMemberRole.MANAGER || callerRole === ProjectMemberRole.OWNER;
      const isOrgAdmin = profile.role === 'ADMIN';
      if (!isManagerOrOwner && !isOrgAdmin) {
        throw new TaskServiceError('Only MANAGER or OWNER can assign milestones', 403);
      }
      data.milestoneId    = input.milestoneId ?? null;
      data.milestoneOrder = input.milestoneOrder ?? null;
    }
    if (input.milestoneOrder !== undefined && input.milestoneId === undefined) {
      data.milestoneOrder = input.milestoneOrder ?? null;
    }

    // completedAt and inProgressAt are server-managed only
    // Transition: non-done → done sets completedAt once; done → non-done clears it;
    // non-doing → doing sets inProgressAt once (never overwritten)
    const isCompletingNow = input.status === 'done' && task.status !== 'done';
    const isStartingNow   = input.status === 'doing' && task.status !== 'doing' && !task.inProgressAt;
    if (input.status !== undefined) {
      data.status = input.status;
      if (isCompletingNow) {
        data.completedAt = new Date();
      } else if (input.status !== 'done') {
        data.completedAt = null;
      }
      if (isStartingNow) {
        data.inProgressAt = new Date();
      }
      // done → done: completedAt not added to data, Prisma leaves it unchanged
    }

    const updated = await this.taskRepo.update(task.id, data);

    // When recurrenceEndDate changes on any recurring task (parent or child),
    // propagate the new end date to the root parent and purge instances that
    // now fall outside the new boundary. Child instances carry their own
    // recurrenceEndDate copy; the root parent is the authoritative source for
    // sibling cleanup since deleteManyByParentIdFromDate queries by parentId.
    if (input.recurrenceEndDate !== undefined && task.isRecurring) {
      const rootId = task.recurrenceParentId ?? task.id;
      const newEndDate = data.recurrenceEndDate ?? null;

      if (task.recurrenceParentId) {
        // Propagate new end date up to the root parent so it stays consistent
        await this.taskRepo.update(task.recurrenceParentId, { recurrenceEndDate: newEndDate });
      }

      // Sync recurrenceEndDate on all remaining sibling instances so every
      // child reflects the same end date regardless of which one was edited
      await this.taskRepo.updateManyByParentId(rootId, { recurrenceEndDate: newEndDate });

      if (newEndDate !== null) {
        // Purge uncompleted instances scheduled after the new end date
        await this.taskRepo.deleteManyByParentIdFromDate(
          rootId,
          new Date(newEndDate.getTime() + 1),
        );
      }
    }

    // Emit realtime to all subscribers of this task room
    realtimeService.emitTaskUpdated(task.id, {
      taskId: task.id,
      updatedFields: Object.keys(data),
      updatedAt: updated.updatedAt,
    });

    // Emit planning:updated when milestone assignment changes
    if (data.milestoneId !== undefined && task.projectId) {
      realtimeService.emitPlanningUpdated(task.projectId, { type: 'task_milestone_changed', updatedAt: updated.updatedAt });
    }

    // Always notify planning view immediately for any change to a milestone task
    if (task.milestoneId && task.projectId && !task.parentTaskId) {
      realtimeService.emitPlanningUpdated(task.projectId, { type: 'task_milestone_changed', updatedAt: updated.updatedAt });
    }

    // Auto-complete / re-open milestone — fire-and-forget so HTTP response is not blocked;
    // checkAndUpdateCompletion emits planning:updated on all paths when it finishes
    if (data.status !== undefined && task.milestoneId && task.projectId && !task.parentTaskId) {
      void checkAndUpdateCompletion(task.milestoneId, task.projectId);
    }

    // Notify new assignee (fire-and-forget)
    if (data.assignedTo && task.projectId) {
      void notificationService.notifyTaskAssigned({
        assigneeId: data.assignedTo,
        actorId: profileId,
        actorName: profile.name,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.projectId,
      }).catch(err => logger.error({ err, context: 'notifyTaskAssigned', taskId: task.id }, 'Fire-and-forget failed'));
    }

    return mapPrismaTaskToResponseDTO({ ...updated, profile }, { name: profile.name, email: profile.email, avatar: profile.avatar });
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

  // ─── Cancel From Date ─────────────────────────────────────────────────────

  async cancelFromDate(
    profileId: string,
    taskId: string,
    fromDate: string
  ): Promise<{ cancelled: number }> {
    const task = await this.taskRepo.findByIdOrMongoId(taskId);
    if (!task) throw new TaskServiceError('Task not found', 404);
    if (!task.isRecurring) throw new TaskServiceError('Task is not recurring', 400);
    if (task.recurrenceParentId) throw new TaskServiceError('Use the parent task to cancel from a date', 400);

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(task, profileId, profile, 'write');

    const from = new Date(fromDate);

    const cancelled = await this.taskRepo.deleteManyByParentIdFromDate(task.id, from);

    // Set recurrenceEndDate to the day before fromDate
    const newEndDate = new Date(from);
    newEndDate.setUTCDate(newEndDate.getUTCDate() - 1);
    await this.taskRepo.update(task.id, { recurrenceEndDate: newEndDate });

    return { cancelled };
  }

  // ─── Subtasks ─────────────────────────────────────────────────────────────

  async listSubtasks(profileId: string, parentId: string): Promise<TaskResponseDTO[]> {
    const parent = await this.taskRepo.findByIdOrMongoId(parentId);
    if (!parent) throw new TaskServiceError('Task not found', 404);

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(parent, profileId, profile, 'read');

    const subtasks = await this.taskRepo.findSubtasksByParent(parent.id);
    return subtasks.map(s => {
      const t = s as typeof s & { profile?: { mongoId: string | null; name: string | null; email: string; avatar: string | null } | null };
      return mapPrismaTaskToResponseDTO({ ...s, profile }, t.profile);
    });
  }

  async createSubtask(profileId: string, parentId: string, input: CreateSubtaskInput): Promise<TaskResponseDTO> {
    if (!input.title?.trim()) throw new TaskServiceError('Title is required', 400);

    const parent = await this.taskRepo.findByIdOrMongoId(parentId);
    if (!parent) throw new TaskServiceError('Task not found', 404);
    if (parent.parentTaskId) throw new TaskServiceError('Cannot create subtask of a subtask', 400);

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(parent, profileId, profile, 'write');

    const now = new Date();
    const subtask = await this.taskRepo.create({
      title:       input.title.trim(),
      description: input.description ?? '',
      status:      'todo',
      priority:    input.priority ?? 'medium',
      tags:        input.tags ?? [],
      profileId:   profile.id,
      scheduledAt: now,
      parentTaskId: parent.id,
      ...(parent.projectId  && { projectId:   parent.projectId }),
      ...(parent.milestoneId && { milestoneId: parent.milestoneId }),
      ...(input.deadline != null && { deadline: new Date(input.deadline) }),
    });

    return mapPrismaTaskToResponseDTO({ ...subtask, profile }, { name: profile.name, email: profile.email, avatar: profile.avatar });
  }

  async updateSubtask(
    profileId: string,
    parentId: string,
    subtaskId: string,
    input: UpdateSubtaskInput
  ): Promise<TaskResponseDTO> {
    const parent = await this.taskRepo.findByIdOrMongoId(parentId);
    if (!parent) throw new TaskServiceError('Task not found', 404);

    const subtask = await this.taskRepo.findById(subtaskId);
    if (!subtask || subtask.parentTaskId !== parent.id) throw new TaskServiceError('Subtask not found', 404);

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(subtask, profileId, profile, 'write');

    const data: UpdateTaskData = {};
    if (input.title       !== undefined) data.title       = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priority    !== undefined) data.priority    = input.priority;
    if (input.tags        !== undefined) data.tags        = input.tags;
    if (input.deadline    !== undefined) data.deadline    = input.deadline ? new Date(input.deadline) : null;

    if (input.status !== undefined) {
      data.status = input.status;
      const isCompletingNow = input.status === 'done' && subtask.status !== 'done';
      const isStartingNow   = input.status === 'doing' && subtask.status !== 'doing' && !subtask.inProgressAt;
      if (isCompletingNow) {
        data.completedAt = new Date();
      } else if (input.status !== 'done') {
        data.completedAt = null;
      }
      if (isStartingNow) data.inProgressAt = new Date();
    }

    const updated = await this.taskRepo.update(subtask.id, data);
    return mapPrismaTaskToResponseDTO({ ...updated, profile }, { name: profile.name, email: profile.email, avatar: profile.avatar });
  }

  async deleteSubtask(profileId: string, parentId: string, subtaskId: string): Promise<void> {
    const parent = await this.taskRepo.findByIdOrMongoId(parentId);
    if (!parent) throw new TaskServiceError('Task not found', 404);

    const subtask = await this.taskRepo.findById(subtaskId);
    if (!subtask || subtask.parentTaskId !== parent.id) throw new TaskServiceError('Subtask not found', 404);

    const profile = await this.resolveProfile(profileId);
    await this.resolveTaskPermission(subtask, profileId, profile, 'write');

    await this.taskRepo.delete(subtask.id);
  }

  async moveSubtask(
    profileId: string,
    parentId: string,
    subtaskId: string,
    newParentId: string
  ): Promise<TaskResponseDTO> {
    const parent = await this.taskRepo.findByIdOrMongoId(parentId);
    if (!parent) throw new TaskServiceError('Task not found', 404);

    const subtask = await this.taskRepo.findById(subtaskId);
    if (!subtask || subtask.parentTaskId !== parent.id) throw new TaskServiceError('Subtask not found', 404);

    const profile = await this.resolveProfile(profileId);

    // Move requires MANAGER+ on the parent task's project
    if (parent.projectId) {
      const projectMember = await projectRepository.getMember(parent.projectId, profileId);
      const isManagerOrOwner = projectMember?.role === ProjectMemberRole.MANAGER || projectMember?.role === ProjectMemberRole.OWNER;
      const isOrgAdmin = profile.role === 'ADMIN';
      if (!isManagerOrOwner && !isOrgAdmin) {
        throw new TaskServiceError('Only MANAGER or OWNER can move subtasks', 403);
      }
    } else if (parent.profileId !== profileId && profile.role !== 'ADMIN') {
      throw new TaskServiceError('Not authorized to move this subtask', 403);
    }

    const newParent = await this.taskRepo.findByIdOrMongoId(newParentId);
    if (!newParent) throw new TaskServiceError('New parent task not found', 404);
    if (newParent.parentTaskId) throw new TaskServiceError('Cannot move subtask to another subtask', 400);
    if (newParent.id === subtask.id) throw new TaskServiceError('Cannot move task to itself', 400);

    const data: UpdateTaskData = {
      parentTaskId: newParent.id,
      ...(newParent.projectId  !== undefined && { projectId:   newParent.projectId ?? null }),
      ...(newParent.milestoneId !== undefined && { milestoneId: newParent.milestoneId ?? null }),
    };

    const updated = await this.taskRepo.update(subtask.id, data);

    const effectiveProjectId = newParent.projectId ?? parent.projectId;
    if (effectiveProjectId) {
      realtimeService.emitPlanningUpdated(effectiveProjectId, { type: 'subtask_moved', updatedAt: updated.updatedAt });
    }

    return mapPrismaTaskToResponseDTO({ ...updated, profile }, { name: profile.name, email: profile.email, avatar: profile.avatar });
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

  }
}
