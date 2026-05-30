import { z } from 'zod';
import { DepartmentMemberRole } from '@prisma/client';


export const createDepartmentSchema = z.object({
  name:        z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(500).optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name:        z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const addMemberSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role:   z.nativeEnum(DepartmentMemberRole).optional(),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const changeMemberRoleSchema = z.object({
  role: z.nativeEnum(DepartmentMemberRole, { message: 'role is required' }),
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().min(1, 'newOwnerId is required'),
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

export const assignUserToDepartmentSchema = z.object({
  departmentId: z.string().min(1, 'departmentId is required'),
  role:         z.nativeEnum(DepartmentMemberRole).optional(),
});
export type AssignUserToDepartmentInput = z.infer<typeof assignUserToDepartmentSchema>;

export const removeUserFromDepartmentSchema = z.object({
  departmentId: z.string().min(1, 'departmentId is required'),
});
export type RemoveUserFromDepartmentInput = z.infer<typeof removeUserFromDepartmentSchema>;

export const deleteDepartmentQuerySchema = z.object({
  force: z.string().optional().transform(v => v === 'true'),
});
export type DeleteDepartmentQuery = z.infer<typeof deleteDepartmentQuerySchema>;

export const getDepartmentsQuerySchema = z.object({
  page:  z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});
export type GetDepartmentsQuery = z.infer<typeof getDepartmentsQuerySchema>;

export const getMembersQuerySchema = z.object({
  page:  z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type GetMembersQuery = z.infer<typeof getMembersQuerySchema>;

export const getInvitationsQuerySchema = z.object({
  page:  z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type GetInvitationsQuery = z.infer<typeof getInvitationsQuerySchema>;

export const getWorkloadQuerySchema = z.object({
  page:  z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type GetWorkloadQuery = z.infer<typeof getWorkloadQuerySchema>;

export const getMemberTasksQuerySchema = z.object({
  status:        z.enum(['todo', 'doing', 'done']).optional(),
  priority:      z.enum(['low', 'medium', 'high']).optional(),
  deadlineBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD').optional(),
  page:          z.coerce.number().int().positive().max(1000).default(1),
  limit:         z.coerce.number().int().positive().max(50).default(20),
});
export type GetMemberTasksQuery = z.infer<typeof getMemberTasksQuerySchema>;
