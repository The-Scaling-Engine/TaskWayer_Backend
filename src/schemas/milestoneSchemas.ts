import { z } from 'zod';

export const createMilestoneSchema = z.object({
  title:       z.string().trim().min(1, 'Title is required').max(255),
  description: z.string().trim().max(2000).optional(),
  startDate:   z.string().datetime({ offset: true }).nullable().optional(),
  deadline:    z.string().datetime({ offset: true }).nullable().optional(),
});
export type CreateMilestoneBody = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z.object({
  title:       z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  startDate:   z.string().datetime({ offset: true }).nullable().optional(),
  deadline:    z.string().datetime({ offset: true }).nullable().optional(),
  status:      z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
});
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneSchema>;

export const reorderMilestonesSchema = z.object({
  items: z.array(
    z.object({
      id:    z.string().uuid(),
      order: z.number().int().min(0),
    })
  ).min(1),
});
export type ReorderMilestonesBody = z.infer<typeof reorderMilestonesSchema>;

export const reorderMilestoneTasksSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderMilestoneTasksBody = z.infer<typeof reorderMilestoneTasksSchema>;
