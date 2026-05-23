import { z } from 'zod';

export const createTodoSchema = z.object({
  text: z.string().min(1, 'Text is required').max(500, 'Text must be 500 characters or less').trim(),
  tags: z.array(z.string().max(50).trim().toLowerCase()).optional().default([]),
});
export type CreateTodoInput = z.infer<typeof createTodoSchema>;

export const updateTodoSchema = z
  .object({
    text: z.string().min(1).max(500).trim().optional(),
    done: z.boolean().optional(),
    tags: z.array(z.string().max(50).trim().toLowerCase()).optional(),
  })
  .refine(data => data.text !== undefined || data.done !== undefined || data.tags !== undefined, {
    message: 'At least one field (text, done, or tags) must be provided',
  });
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
