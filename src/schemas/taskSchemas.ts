import { z } from 'zod';

export const createTaskSchema = z.object({
  title:             z.string().trim().min(1, 'Title is required').max(255),
  description:       z.string().trim().max(5000).optional(),
  status:            z.enum(['todo', 'doing', 'done']).optional(),
  priority:          z.enum(['low', 'medium', 'high']).optional(),
  tags:              z.array(z.string().trim()).optional(),
  deadline:          z.string().datetime({ offset: true }).nullable().optional(),
  departmentId:      z.string().uuid('Invalid departmentId').optional(),
  isRecurring:       z.boolean().optional(),
  recurrenceType:    z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.isRecurring) {
    if (!data.deadline) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'deadline is required when isRecurring is true', path: ['deadline'] });
    }
    if (!data.recurrenceType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'recurrenceType is required when isRecurring is true', path: ['recurrenceType'] });
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
  recurrenceEndDate: z.string().datetime({ offset: true }).nullable().optional(),
});
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;

export const getTasksQuerySchema = z.object({
  page:          z.coerce.number().int().positive().max(1000).default(1),
  limit:         z.coerce.number().int().positive().max(100).default(10),
  status:        z.enum(['todo', 'doing', 'done']).optional(),
  priority:      z.enum(['low', 'medium', 'high']).optional(),
  search:        z.string().trim().optional(),
  tag:           z.string().trim().optional(),
  sortBy:        z.enum(['deadline', 'createdAt', 'priority', 'status', 'title']).optional(),
  order:         z.enum(['asc', 'desc']).optional(),
  deadlineFrom:  z.string().datetime({ offset: true }).optional(),
  deadlineTo:    z.string().datetime({ offset: true }).optional(),
});
export type GetTasksQuery = z.infer<typeof getTasksQuerySchema>;
