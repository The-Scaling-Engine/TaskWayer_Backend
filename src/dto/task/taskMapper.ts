import { Task as PrismaTask, RecurrenceType } from '@prisma/client';
import { TaskResponseDTO } from './taskResponse.dto';

type ViewerProfile = { mongoId?: string | null };
type CreatorProfile = { name?: string | null; email?: string | null; avatar?: string | null } | null;

export const mapPrismaTaskToResponseDTO = (
  task: PrismaTask & { profile?: ViewerProfile },
  creatorProfile?: CreatorProfile
): TaskResponseDTO => {
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
    projectId: task.projectId ?? null,
    columnId: task.columnId ?? null,
    assignedTo: task.assignedTo ?? null,
    assignedBy: task.assignedBy ?? null,
    userId: task.profile?.mongoId ?? task.profileId,
    isRecurring: task.isRecurring,
    recurrenceType: (task.recurrenceType as RecurrenceType | null) ?? null,
    recurrenceInterval: task.recurrenceInterval ?? null,
    recurrenceEndDate: task.recurrenceEndDate ?? null,
    recurrenceParentId: task.recurrenceParentId ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    __v: 0,
    createdBy: creatorProfile
      ? { name: creatorProfile.name ?? null, email: creatorProfile.email ?? null, avatar: creatorProfile.avatar ?? null }
      : null,
  };
};

export const mapPrismaTasksToResponseDTO = (
  tasks: Array<PrismaTask & { profile?: ViewerProfile }>
): TaskResponseDTO[] => {
  return tasks.map((t) => mapPrismaTaskToResponseDTO(t));
};
