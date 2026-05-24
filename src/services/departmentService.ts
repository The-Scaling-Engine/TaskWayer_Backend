import { Department } from '@prisma/client';
import { PrismaDepartmentRepository } from '../repositories/prisma/departmentRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import * as notificationService from './notificationService';
import {
  CreateDepartmentData,
  UpdateDepartmentData,
  DepartmentWithMembers,
  PaginatedDepartmentsResult,
} from '../repositories/interfaces';

const departmentRepo = new PrismaDepartmentRepository();
const membershipRepo = new PrismaMembershipRepository();
const taskRepo = new PrismaTaskRepository();
const profileRepo = new PrismaProfileRepository();

// ─── Department CRUD ──────────────────────────────────────────

export const createDepartment = async (data: CreateDepartmentData): Promise<Department> => {
  if (!data.name || data.name.trim().length === 0) {
    throw new ServiceError('Department name is required', 400);
  }

  const trimmedName = data.name.trim();

  const existing = await departmentRepo.findByName(trimmedName);
  if (existing) {
    throw new ServiceError(`Department with name "${trimmedName}" already exists`, 409);
  }

  const createData: CreateDepartmentData = { name: trimmedName };
  if (data.description && data.description.trim().length > 0) {
    createData.description = data.description.trim();
  }

  return departmentRepo.create(createData);
};

export const getDepartments = async (
  page: number,
  limit: number
): Promise<PaginatedDepartmentsResult> => {
  return departmentRepo.findAllWithCount(page, limit);
};

export const getDepartmentById = async (id: string): Promise<DepartmentWithMembers> => {
  const department = await departmentRepo.findWithMembers(id);
  if (!department) throw new ServiceError('Department not found', 404);
  return department;
};

export const updateDepartment = async (
  id: string,
  data: UpdateDepartmentData
): Promise<Department> => {
  const existing = await departmentRepo.findById(id);
  if (!existing) throw new ServiceError('Department not found', 404);

  if (data.name !== undefined) {
    const trimmedName = data.name.trim();
    if (trimmedName.length === 0) throw new ServiceError('Department name cannot be empty', 400);

    const duplicate = await departmentRepo.findByName(trimmedName);
    if (duplicate && duplicate.id !== id) {
      throw new ServiceError(`Department with name "${trimmedName}" already exists`, 409);
    }
    data.name = trimmedName;
  }

  if (data.description !== undefined) {
    data.description = data.description.trim();
  }

  return departmentRepo.update(id, data);
};

export const deleteDepartment = async (
  id: string,
  force: boolean = false
): Promise<Department> => {
  const existing = await departmentRepo.findById(id);
  if (!existing) throw new ServiceError('Department not found', 404);

  const memberCount = await membershipRepo.countActive(id);

  if (memberCount > 0 && !force) {
    throw new ServiceError(
      `Cannot delete department: ${memberCount} active member(s) still assigned. ` +
        `Remove all members first, or use ?force=true to force deletion.`,
      409
    );
  }

  // With force=true: delete department — DepartmentMember cascade handles cleanup
  return departmentRepo.delete(id);
};

// ─── Assign Task ─────────────────────────────────────────────

export interface AssignTaskInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  deadline?: string;
  scheduledAt?: string;
  tags?: string[];
  isRecurring?: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null;
  recurrenceEndDate?: string | null;
}

export const assignTask = async (
  requesterProfileId: string,
  departmentId: string,
  targetUserId: string,
  input: AssignTaskInput,
  callerSystemRole?: string
): Promise<import('@prisma/client').Task> => {
  const dept = await departmentRepo.findById(departmentId);
  if (!dept) throw new ServiceError('Department not found', 404);

  let requesterRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

  if (callerSystemRole === 'ADMIN') {
    // System-level admins bypass dept membership — treat as OWNER
    requesterRole = 'OWNER';
  } else {
    const requesterMembership = await membershipRepo.findByUserAndDepartment(requesterProfileId, departmentId);
    if (!requesterMembership || requesterMembership.status !== 'ACTIVE') {
      throw new ServiceError('You are not an active member of this department', 403);
    }
    requesterRole = requesterMembership.role;
    if (requesterRole !== 'OWNER' && requesterRole !== 'ADMIN') {
      throw new ServiceError('Only OWNER or ADMIN can assign tasks', 403);
    }
  }

  const targetMembership = await membershipRepo.findByUserAndDepartment(targetUserId, departmentId);
  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new ServiceError('Target user is not an active member of this department', 404);
  }

  const targetRole = targetMembership.role;

  if (targetUserId === requesterProfileId) {
    throw new ServiceError('Cannot assign task to yourself', 403);
  }

  // Cannot assign to OWNER (protect dept owners from receiving assigned tasks)
  if (targetRole === 'OWNER') {
    throw new ServiceError('Cannot assign tasks to a department OWNER', 403);
  }

  // ADMIN can only assign to MEMBER (not to other ADMINs)
  if (requesterRole === 'ADMIN' && targetRole === 'ADMIN') {
    throw new ServiceError('ADMIN can only assign tasks to MEMBER role', 403);
  }

  const task = await taskRepo.create({
    title:       input.title.trim(),
    description: input.description ?? '',
    priority:    input.priority ?? 'medium',
    tags:        input.tags ?? [],
    profileId:   requesterProfileId,
    departmentId,
    isAssigned:  true,
    assignedTo:  targetUserId,
    assignedBy:  requesterProfileId,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : new Date(),
    ...(input.deadline           != null && { deadline:           new Date(input.deadline) }),
    isRecurring:                           input.isRecurring ?? false,
    ...(input.recurrenceType     != null && { recurrenceType:     input.recurrenceType as import('@prisma/client').RecurrenceType }),
    ...(input.recurrenceEndDate  != null && { recurrenceEndDate:  new Date(input.recurrenceEndDate) }),
  });

  const requesterProfile = await profileRepo.findById(requesterProfileId);
  const actorName = requesterProfile?.name ?? requesterProfile?.email ?? 'Your manager';

  void notificationService.createNotification({
    userId:     targetUserId,
    type:       'TASK_ASSIGNED',
    title:      'New task assigned to you',
    message:    `${actorName} in "${dept.name}" assigned you a new task: ${task.title}`,
    payload:    { taskId: task.id, departmentId: dept.id, actorId: requesterProfileId },
    entityType: 'task',
    entityId:   task.id,
  });

  return task;
};

// ─── Service Error ────────────────────────────────────────────

export class ServiceError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
  }
}
