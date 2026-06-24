import { z } from 'zod';

export const getUsersQuerySchema = z.object({
  page:   z.coerce.number().int().positive().max(10000).default(1),
  limit:  z.coerce.number().int().positive().max(50).default(10),
  search: z.string().trim().optional(),
});
export type GetUsersQuery = z.infer<typeof getUsersQuerySchema>;

export const createUserSchema = z.object({
  name:     z.string().trim().min(1, 'Name is required').max(100),
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(50)
              .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  email:    z.string().trim().email('Invalid email address').toLowerCase(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const changeUserRoleSchema = z.object({
  role: z.enum(['USER', 'MANAGER']),
});
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;
