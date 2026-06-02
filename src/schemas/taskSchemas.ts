import { z } from 'zod';

export const createTaskSchema = z.object({
  title:             z.string().trim().min(1, 'Title is required').max(255),
  description:       z.string().trim().max(5000).optional(),
  status:            z.enum(['todo', 'doing', 'done']).optional(),
  priority:          z.enum(['low', 'medium', 'high']).optional(),
  tags:              z.array(z.string().trim()).optional(),
  deadline:          z.string().datetime({ offset: true }).nullable().optional(),
  scheduledAt:       z.string().datetime({ offset: true }).nullable().optional(),
  projectId:         z.string().uuid('Invalid projectId').optional(),
  columnId:          z.string().uuid('Invalid columnId').nullable().optional(),
  assignedTo:        z.string().uuid('Invalid assignedTo').nullable().optional(),
  isRecurring:        z.boolean().default(false),
  recurrenceType:     z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional().nullable(),
  recurrenceInterval: z.coerce.number().int().positive().max(365).nullable().optional(),
  recurrenceEndDate:  z.string().datetime({ offset: true }).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.isRecurring) {
    if (!data.recurrenceType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please select how often this task repeats', path: ['recurrenceType'] });
    }
  }
});
export type CreateTaskBody = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title:             z.string().trim().min(1).max(255).optional(),
  description:       z.string().trim().max(5000).optional(),
  status:            z.enum(['todo', 'doing', 'done']).optional(),
  priority:          z.enum(['low', 'medium', 'high']).optional(),
  tags:              z.array(z.string().trim()).optional(),
  deadline:          z.string().datetime({ offset: true }).nullable().optional(),
  scheduledAt:       z.string().datetime({ offset: true }).nullable().optional(),
  columnId:          z.string().uuid('Invalid columnId').nullable().optional(),
  isRecurring:        z.boolean().optional(),
  recurrenceType:     z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional().nullable(),
  recurrenceInterval: z.coerce.number().int().positive().max(365).nullable().optional(),
  recurrenceEndDate:  z.string().datetime({ offset: true }).nullable().optional(),
  assignedTo:         z.string().uuid('Invalid assignedTo').nullable().optional(),
  milestoneId:        z.string().uuid('Invalid milestoneId').nullable().optional(),
  milestoneOrder:     z.coerce.number().int().min(0).nullable().optional(),
});
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;

export const cancelRecurrenceSchema = z.object({
  keepChildren: z.boolean(),
});

export const cancelFromDateSchema = z.object({
  fromDate: z.string().date('fromDate must be a valid date (YYYY-MM-DD)'),
});

export const bulkCreateSchema = z.object({
  projectId: z.string().uuid('Invalid projectId').optional(),
  columnId:  z.string().uuid('Invalid columnId').nullable().optional(),
  priority:  z.enum(['low', 'medium', 'high']).optional(),
  tasks: z.array(
    z.object({
      title:    z.string().max(255),
      priority: z.enum(['low', 'medium', 'high']).optional(),
    })
  ).min(1, 'At least one task is required').max(50, 'Max 50 tasks per request'),
});
export type BulkCreateBody = z.infer<typeof bulkCreateSchema>;

export const getTasksQuerySchema = z.object({
  page:         z.coerce.number().int().positive().max(1000).default(1),
  limit:        z.coerce.number().int().positive().max(100).default(10),
  status:       z.enum(['todo', 'doing', 'done']).optional(),
  priority:     z.enum(['low', 'medium', 'high']).optional(),
  search:       z.string().trim().optional(),
  tag:          z.string().trim().optional(),
  sortBy:       z.enum(['deadline', 'createdAt', 'priority', 'status', 'title']).optional(),
  order:        z.enum(['asc', 'desc']).optional(),
  deadlineFrom: z.string().date().optional(),
  deadlineTo:   z.string().date().optional(),
  createdFrom:    z.string().date().optional(),
  createdTo:      z.string().date().optional(),
  scheduledFrom:  z.string().date().optional(),
  scheduledTo:    z.string().date().optional(),
  personal:       z.coerce.boolean().optional(),
  assignedByMe:   z.coerce.boolean().optional(),
  assignedToMe:   z.coerce.boolean().optional(),
  projectId:      z.string().uuid().optional(),
});
export type GetTasksQuery = z.infer<typeof getTasksQuerySchema>;
