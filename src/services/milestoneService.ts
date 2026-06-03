import { MilestoneStatus } from '@prisma/client';
import { milestoneRepository } from '../repositories/prisma/milestoneRepository';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { projectRepository, MANAGER_ROLES } from '../repositories/prisma/projectRepository';

const taskRepository = new PrismaTaskRepository();
import { ServiceError } from './departmentService';
import { assertProjectReadable } from './projectService';
import * as notificationService from './notificationService';
import { emitPlanningUpdated } from './realtimeService';

// ─── Permission helpers ───────────────────────────────────────

async function assertManager(projectId: string, profileId: string) {
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member) throw new ServiceError('Access denied: not a project member', 403);
  if (!MANAGER_ROLES.includes(member.role)) {
    throw new ServiceError('Only OWNER or MANAGER can manage milestones', 403);
  }
  return member;
}

// ─── Service ─────────────────────────────────────────────────

export const listMilestones = async (projectId: string, requesterId: string) => {
  await assertProjectReadable(projectId, requesterId);
  return milestoneRepository.findAllByProject(projectId);
};

export const createMilestone = async (
  projectId: string,
  requesterId: string,
  data: { title: string; description?: string; startDate?: string | null; deadline?: string | null }
) => {
  await assertManager(projectId, requesterId);
  const created = await milestoneRepository.create({
    projectId,
    title: data.title.trim(),
    ...(data.description !== undefined && { description: data.description.trim() }),
    ...(data.startDate   != null        && { startDate:   new Date(data.startDate) }),
    ...(data.deadline    != null        && { deadline:    new Date(data.deadline) }),
  });
  emitPlanningUpdated(projectId, { type: 'milestone_crud', updatedAt: created.createdAt });
  return created;
};

export const updateMilestone = async (
  projectId: string,
  milestoneId: string,
  requesterId: string,
  data: {
    title?:       string;
    description?: string | null;
    startDate?:   string | null;
    deadline?:    string | null;
    status?:      string;
  }
) => {
  await assertManager(projectId, requesterId);

  const milestone = await milestoneRepository.findById(milestoneId);
  if (!milestone || milestone.projectId !== projectId) {
    throw new ServiceError('Milestone not found', 404);
  }

  const wasActive = milestone.status === MilestoneStatus.ACTIVE;
  const becomesCompleted = data.status === MilestoneStatus.COMPLETED;

  const updated = await milestoneRepository.update(milestoneId, {
    ...(data.title       !== undefined && { title:       data.title.trim() }),
    ...(data.description !== undefined && { description: data.description?.trim() ?? null }),
    ...(data.startDate   !== undefined && { startDate:   data.startDate ? new Date(data.startDate) : null }),
    ...(data.deadline    !== undefined && { deadline:    data.deadline  ? new Date(data.deadline)  : null }),
    ...(data.status      !== undefined && { status:      data.status as MilestoneStatus }),
    ...(becomesCompleted && wasActive  && { completedAt: new Date() }),
  });

  if (wasActive && becomesCompleted) {
    void (async () => {
      try {
        const memberIds = await projectRepository.getMemberIds(projectId);
        await Promise.all(
          memberIds.map(userId =>
            notificationService.createNotification({
              userId,
              type:       'MILESTONE_COMPLETED',
              title:      'Milestone completed',
              message:    `Milestone "${updated.title}" has been completed.`,
              payload:    { projectId, milestoneId: updated.id },
              entityType: 'milestone',
              entityId:   updated.id,
            })
          )
        );
      } catch (_) {}
    })();
  }

  emitPlanningUpdated(projectId, { type: wasActive && becomesCompleted ? 'milestone_completed' : 'milestone_crud', updatedAt: updated.updatedAt });
  return updated;
};

export const deleteMilestone = async (
  projectId: string,
  milestoneId: string,
  requesterId: string
) => {
  await assertManager(projectId, requesterId);
  const milestone = await milestoneRepository.findById(milestoneId);
  if (!milestone || milestone.projectId !== projectId) {
    throw new ServiceError('Milestone not found', 404);
  }
  await milestoneRepository.delete(milestoneId);
  emitPlanningUpdated(projectId, { type: 'milestone_crud', updatedAt: new Date() });
};

export const reorderMilestones = async (
  projectId: string,
  requesterId: string,
  items: { id: string; order: number }[]
) => {
  await assertManager(projectId, requesterId);
  const milestones = await milestoneRepository.findAllByProject(projectId);
  const milestoneIds = new Set(milestones.map(m => m.id));
  for (const { id } of items) {
    if (!milestoneIds.has(id)) {
      throw new ServiceError(`Milestone ${id} does not belong to this project`, 400);
    }
  }
  await milestoneRepository.reorder(items, projectId);
  emitPlanningUpdated(projectId, { type: 'milestone_reordered', updatedAt: new Date() });
};

export const getPlanningTree = async (
  projectId: string,
  requesterId: string,
  query: { skip?: number; take?: number }
) => {
  await assertProjectReadable(projectId, requesterId);

  const take = Math.min(100, query.take ?? 50);
  const skip = Math.max(0, query.skip ?? 0);

  const [milestoneItems, { tasks: unassignedTasks, total }] = await Promise.all([
    milestoneRepository.findPlanningTree(projectId),
    taskRepository.findUnassignedByProject(projectId, skip, take),
  ]);

  const now = new Date();

  const milestones = milestoneItems.map((m: typeof milestoneItems[0]) => {
    const tasks = m.tasks;
    const doneCount = tasks.filter((t: typeof tasks[0]) => t.status === 'done').length;
    const totalCount = tasks.length;
    const isOverdue = m.deadline != null && m.deadline < now && m.status !== MilestoneStatus.COMPLETED;

    return {
      ...m,
      progress: {
        done: doneCount,
        total: totalCount,
        percent: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
      },
      isOverdue,
      tasks: tasks.map((t: typeof tasks[0]) => {
        const subtaskList = t.subtasks ?? [];
        const subtaskDone = subtaskList.filter((s: typeof subtaskList[0]) => s.status === 'done').length;
        return {
          ...t,
          subtaskProgress: subtaskList.length > 0
            ? { done: subtaskDone, total: subtaskList.length }
            : undefined,
          subtasks: subtaskList,
        };
      }),
    };
  });

  return {
    milestones,
    unassigned: {
      data: unassignedTasks,
      total,
      page: Math.floor(skip / take) + 1,
      limit: take,
    },
  };
};

export const reorderMilestoneTasks = async (
  projectId: string,
  milestoneId: string,
  requesterId: string,
  orderedIds: string[]
) => {
  await assertManager(projectId, requesterId);

  const milestone = await milestoneRepository.findById(milestoneId);
  if (!milestone || milestone.projectId !== projectId) {
    throw new ServiceError('Milestone not found', 404);
  }

  const existingTasks = await taskRepository.findByMilestone(milestoneId);
  const taskIds = new Set(existingTasks.map(t => t.id));
  for (const id of orderedIds) {
    if (!taskIds.has(id)) {
      throw new ServiceError(`Task ${id} is not in this milestone`, 400);
    }
  }

  await milestoneRepository.reorderTasks(milestoneId, orderedIds);
  emitPlanningUpdated(projectId, { type: 'milestone_reordered', updatedAt: new Date() });
};
