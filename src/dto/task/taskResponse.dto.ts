/**
 * TaskResponseDTO
 *
 * This is the canonical shape returned to the frontend for ALL task-related APIs.
 * It MUST mirror the existing MongoDB Mongoose response shape exactly
 * to ensure zero frontend breakage during Phase 3 cut-over.
 *
 * Key compatibility aliases:
 *  - _id       → aliases Prisma's `id` (UUID) or MongoDB's `_id`
 *  - userId    → aliases Prisma's `profileId` or MongoDB's `userId`
 *  - __v       → Mongoose versioning field, always 0 for Prisma responses
 */
export interface TaskResponseDTO {
  _id: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done';
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  deadline: Date | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  departmentId: string | null;
  projectId: string | null;
  isAssigned: boolean;
  assignedTo: string | null;
  assignedBy: string | null;
  userId: string;
  isRecurring: boolean;
  recurrenceType: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | null;
  recurrenceInterval: number | null;
  recurrenceEndDate: Date | null;
  recurrenceParentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number; // Mongoose compatibility field — always 0 for Prisma
  createdBy: { name: string | null; email: string | null; avatar: string | null } | null;
}
