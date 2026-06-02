import { MilestoneStatus } from '@prisma/client';
import { milestoneRepository } from '../repositories/prisma/milestoneRepository';
import { projectRepository, MANAGER_ROLES } from '../repositories/prisma/projectRepository';
import { ServiceError } from './departmentService';
import { assertProjectReadable } from './projectService';
import * as notificationService from './notificationService';

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
  return milestoneRepository.create({
    projectId,
    title: data.title.trim(),
    ...(data.description !== undefined && { description: data.description.trim() }),
    ...(data.startDate   != null        && { startDate:   new Date(data.startDate) }),
    ...(data.deadline    != null        && { deadline:    new Date(data.deadline) }),
  });
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
};
