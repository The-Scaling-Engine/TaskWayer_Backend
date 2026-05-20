import { Task as PrismaTask, RecurrenceType } from '@prisma/client';
import { TaskResponseDTO } from './taskResponse.dto';

/**
 * mapPrismaTaskToResponseDTO
 *
 * Maps a single Prisma Task record to the canonical TaskResponseDTO.
 *
 * CRITICAL COMPATIBILITY RULES:
 *  - `_id`    = task.id (Prisma UUID, aliased for frontend)
 *  - `userId` = task.mongoId if available (preserves original Mongo userId)
 *              OR task.profileId (Prisma profileId as fallback)
 *              This is essential: the frontend stores/compares userId values.
 *              If a task was migrated from Mongo, mongoId holds the original Mongo userId.
 *  - `__v`    = 0 (Mongoose versioning stub, always 0 for Prisma-sourced data)
 */
export const mapPrismaTaskToResponseDTO = (task: PrismaTask & { profile?: { mongoId?: string | null } }): TaskResponseDTO => {
  return {
    _id: task.id,
    title: task.title,
    description: task.description,
    status: task.status as 'todo' | 'doing' | 'done',
    priority: task.priority as 'low' | 'medium' | 'high',
    tags: task.tags,
    deadline: task.deadline,
    scheduledAt: task.scheduledAt ?? null,
    completedAt: task.completedAt ?? null,
    departmentId: task.departmentId ?? null,
    userId: task.profile?.mongoId ?? task.profileId,
    isRecurring: task.isRecurring,
    recurrenceType: (task.recurrenceType as RecurrenceType | null) ?? null,
    recurrenceEndDate: task.recurrenceEndDate ?? null,
    recurrenceParentId: task.recurrenceParentId ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    __v: 0,
  };
};

/**
 * mapPrismaTasksToResponseDTO
 *
 * Maps an array of Prisma Task records to TaskResponseDTO[].
 */
export const mapPrismaTasksToResponseDTO = (
  tasks: Array<PrismaTask & { profile?: { mongoId?: string | null } }>
): TaskResponseDTO[] => {
  return tasks.map(mapPrismaTaskToResponseDTO);
};
