import { z } from 'zod';

export const createTodoSchema = z.object({
  text: z.string().min(1, 'Text is required').max(500, 'Text must be 500 characters or less').trim(),
});
export type CreateTodoInput = z.infer<typeof createTodoSchema>;

export const updateTodoSchema = z
  .object({
    text: z.string().min(1).max(500).trim().optional(),
    done: z.boolean().optional(),
  })
  .refine(data => data.text !== undefined || data.done !== undefined, {
    message: 'At least one field (text or done) must be provided',
  });
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
