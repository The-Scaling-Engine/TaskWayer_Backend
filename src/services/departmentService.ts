import { Department } from '@prisma/client';
import prisma from '../config/prisma';
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

// ─── Linkable Departments ────────────────────────────────────

export const getLinkableDepartments = async (
  profileId: string
): Promise<{ id: string; name: string }[]> => {
  const profile = await profileRepo.findById(profileId);
  if (profile?.role === 'ADMIN') {
    const all = await departmentRepo.findAll();
    return all.map(d => ({ id: d.id, name: d.name }));
  }
  return departmentRepo.findByUserRole(profileId, ['OWNER', 'ADMIN']);
};

// ─── Linked Projects ─────────────────────────────────────────

export interface LinkedProject {
  id: string;
  name: string;
  description: string | null;
  linkedAt: Date;
  memberCount: number;
  owner: { id: string; name: string | null; avatar: string | null } | null;
}

export const getLinkedProjects = async (
  departmentId: string,
  requesterId: string
): Promise<LinkedProject[]> => {
  const membership = await prisma.departmentMember.findFirst({
    where: { departmentId, userId: requesterId, status: 'ACTIVE' },
  });
  const profile = await profileRepo.findById(requesterId);
  if (!membership && profile?.role !== 'ADMIN') {
    throw new ServiceError('You are not a member of this department', 403);
  }

  const links = await prisma.projectDepartment.findMany({
    where: { departmentId, project: { deletedAt: null } },
    include: {
      project: {
        include: {
          members: {
            where: { role: 'OWNER' },
            include: { profile: { select: { id: true, name: true, avatar: true } } },
            take: 1,
          },
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return links.map(l => ({
    id:          l.project.id,
    name:        l.project.name,
    description: l.project.description,
    linkedAt:    l.createdAt,
    memberCount: l.project._count.members,
    owner:       l.project.members[0]?.profile ?? null,
  }));
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
