import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import logger from '../config/logger';

// ─── Supported project activity events ───────────────────────

export type ProjectActivityAction =
  | 'PROJECT_CREATED'
  | 'PROJECT_DELETED'
  | 'PROJECT_ARCHIVED'
  | 'PROJECT_UNARCHIVED'
  | 'PROJECT_OWNERSHIP_TRANSFERRED'
  | 'PROJECT_MEMBER_ADDED'
  | 'PROJECT_MEMBER_REMOVED'
  | 'PROJECT_MEMBER_LEFT'
  | 'PROJECT_ROLE_CHANGED'
  | 'PROJECT_DEPARTMENT_LINKED'
  | 'PROJECT_DEPARTMENT_UNLINKED'
  | 'PROJECT_TASK_MOVED'
  | 'MILESTONE_COMPLETED';

export interface ProjectActivityInput {
  projectId: string;
  actorId:   string | null;
  action:    ProjectActivityAction;
  metadata?: Record<string, unknown>;
}

// ─── Centralized logger ───────────────────────────────────────

export async function logProjectActivity(input: ProjectActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorUserId:  input.actorId,
        departmentId: null,
        entityType:   'project',
        entityId:     input.projectId,
        action:       input.action,
        metadata:     input.metadata !== undefined ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (err) {
    // Non-blocking: log failure should never break the main operation
    logger.warn({ err, ...input }, 'logProjectActivity failed');
  }
}
