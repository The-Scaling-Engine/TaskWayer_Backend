import { DepartmentMember, DepartmentMemberRole } from '@prisma/client';
import prisma from '../config/prisma';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { PrismaDepartmentRepository } from '../repositories/prisma/departmentRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaActivityLogRepository } from '../repositories/prisma/activityLogRepository';
import { MemberWithProfile, PaginatedMembersResult } from '../repositories/interfaces';
import { ServiceError } from './departmentService';
import { mapPrismaConflict } from '../utils/prismaError';
import * as notificationService from './notificationService';
import logger from '../config/logger';

const membershipRepo = new PrismaMembershipRepository();
const departmentRepo = new PrismaDepartmentRepository();
const profileRepo = new PrismaProfileRepository();
const activityLogRepo = new PrismaActivityLogRepository();

// ─── Role Hierarchy ───────────────────────────────────────────

const ROLE_RANK: Record<DepartmentMemberRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

const canManage = (actor: DepartmentMemberRole, target: DepartmentMemberRole): boolean =>
  ROLE_RANK[actor] > ROLE_RANK[target];

// ─── Read ─────────────────────────────────────────────────────

export const listMembers = async (
  departmentId: string,
  page: number,
  limit: number
): Promise<PaginatedMembersResult> => {
  const dept = await departmentRepo.findById(departmentId);
  if (!dept) throw new ServiceError('Department not found', 404);
  return membershipRepo.findActiveMembersByDepartment(departmentId, page, limit);
};

export const getMembership = async (
  userId: string,
  departmentId: string
): Promise<DepartmentMember | null> => {
  return membershipRepo.findByUserAndDepartment(userId, departmentId);
};

// ─── Add Member (direct, no invitation) ──────────────────────

export const addMember = async (
  actorId: string,
  departmentId: string,
  targetUserId: string,
  role: DepartmentMemberRole = 'MEMBER'
): Promise<DepartmentMember> => {
  const dept = await departmentRepo.findById(departmentId);
  if (!dept) throw new ServiceError('Department not found', 404);

  if (role === 'OWNER') {
    throw new ServiceError('Cannot assign OWNER role directly. Use transfer ownership.', 400);
  }

  const actorProfile = await profileRepo.findById(actorId);
  const isGlobalAdmin = actorProfile?.role === 'ADMIN';

  if (!isGlobalAdmin) {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (!actorMembership || actorMembership.status !== 'ACTIVE') {
      throw new ServiceError('You are not a member of this department', 403);
    }
    if (!['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ServiceError('Only OWNER or ADMIN can add members', 403);
    }
    if (actorMembership.role === 'ADMIN' && role === 'ADMIN') {
      throw new ServiceError('ADMIN cannot assign ADMIN role', 403);
    }
  }

  const targetProfile = await profileRepo.findById(targetUserId);
  if (!targetProfile) throw new ServiceError('User not found', 404);

  const membership = await prisma.$transaction(async (tx) => {
    const existing = await tx.departmentMember.findUnique({
      where: { userId_departmentId: { userId: targetUserId, departmentId } },
    });
    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ServiceError('User is already an active member of this department', 409);
      }
      return tx.departmentMember.update({
        where: { id: existing.id },
        data: { role, status: 'ACTIVE' },
      });
    }
    return tx.departmentMember.create({
      data: { userId: targetUserId, departmentId, role, invitedBy: actorId },
    });
  }).catch((err: unknown) => mapPrismaConflict(err, 'User already has an active department membership'));

  void activityLogRepo.create({
    actorUserId: actorId,
    departmentId,
    entityType: 'membership',
    entityId: membership.id,
    action: 'member.added',
    metadata: { targetUserId, role },
  });

  const actorName = actorProfile?.name ?? actorProfile?.email ?? 'An admin';
  void notificationService.createNotification({
    userId:     targetUserId,
    type:       'DEPT_MEMBER_JOINED',
    title:      'You have been added to a department',
    message:    `${actorName} added you to "${dept.name}" as ${role}.`,
    payload:    { departmentId, actorId, role },
    entityType: 'department',
    entityId:   departmentId,
  }).catch(err => logger.error({ err, context: 'member.added notification' }, 'Fire-and-forget failed'));

  return membership;
};

// ─── Admin-level Add (bypasses RBAC check) ───────────────────

export const adminAddMember = async (
  targetUserId: string,
  departmentId: string,
  role: DepartmentMemberRole = 'MEMBER',
  actorId?: string
): Promise<DepartmentMember> => {
  const dept = await departmentRepo.findById(departmentId);
  if (!dept) throw new ServiceError('Department not found', 404);

  const targetProfile = await profileRepo.findById(targetUserId);
  if (!targetProfile) throw new ServiceError('User not found', 404);

  if (role === 'OWNER') throw new ServiceError('Cannot assign OWNER via admin route. Use transfer ownership.', 400);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.departmentMember.findUnique({
      where: { userId_departmentId: { userId: targetUserId, departmentId } },
    });
    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ServiceError('User is already an active member of this department', 409);
      }
      return tx.departmentMember.update({
        where: { id: existing.id },
        data: { role, status: 'ACTIVE' },
      });
    }
    return tx.departmentMember.create({
      data: {
        userId: targetUserId,
        departmentId,
        role,
        status: 'ACTIVE',
        invitedBy: actorId ?? null,
      },
    });
  }).catch((err: unknown) => mapPrismaConflict(err, 'User is already a member of this department'));
};

// ─── Remove Member ────────────────────────────────────────────

export const removeMember = async (
  actorId: string,
  departmentId: string,
  targetUserId: string
): Promise<void> => {
  const actorProfile = await profileRepo.findById(actorId);
  const isGlobalAdmin = actorProfile?.role === 'ADMIN';

  if (!isGlobalAdmin) {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (!actorMembership || actorMembership.status !== 'ACTIVE') {
      throw new ServiceError('You are not a member of this department', 403);
    }
    if (!['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ServiceError('Only OWNER or ADMIN can remove members', 403);
    }
  }

  const targetMembership = await membershipRepo.findByUserAndDepartment(targetUserId, departmentId);
  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new ServiceError('User is not an active member of this department', 404);
  }

  if (targetMembership.role === 'OWNER') {
    throw new ServiceError('Cannot remove the department OWNER. Transfer ownership first.', 400);
  }

  if (!isGlobalAdmin) {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (actorMembership && !canManage(actorMembership.role, targetMembership.role)) {
      throw new ServiceError('Insufficient permissions to remove this member', 403);
    }
  }

  await membershipRepo.update(targetMembership.id, { status: 'REMOVED' });
  void activityLogRepo.create({
    actorUserId: actorId,
    departmentId,
    entityType: 'membership',
    entityId: targetMembership.id,
    action: 'member.removed',
    metadata: { targetUserId, role: targetMembership.role },
  });
};

// ─── Change Role ──────────────────────────────────────────────

export const changeRole = async (
  actorId: string,
  departmentId: string,
  targetUserId: string,
  newRole: DepartmentMemberRole
): Promise<DepartmentMember> => {
  const actorProfile = await profileRepo.findById(actorId);
  const isGlobalAdmin = actorProfile?.role === 'ADMIN';

  if (!isGlobalAdmin) {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (!actorMembership || actorMembership.status !== 'ACTIVE') {
      throw new ServiceError('You are not a member of this department', 403);
    }
    if (!['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ServiceError('Only OWNER or ADMIN can change roles', 403);
    }
  }

  const targetMembership = await membershipRepo.findByUserAndDepartment(targetUserId, departmentId);
  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new ServiceError('User is not an active member of this department', 404);
  }

  if (targetMembership.role === 'OWNER') {
    throw new ServiceError('Cannot change OWNER role. Use transfer ownership.', 400);
  }

  if (newRole === 'OWNER') {
    throw new ServiceError('Cannot promote to OWNER. Use transfer ownership.', 400);
  }

  if (!isGlobalAdmin) {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (actorMembership) {
      if (!canManage(actorMembership.role, targetMembership.role)) {
        throw new ServiceError('Insufficient permissions to change this member\'s role', 403);
      }
      if (actorMembership.role === 'ADMIN' && newRole === 'ADMIN') {
        throw new ServiceError('ADMIN cannot promote another user to ADMIN', 403);
      }
    }
  }

  const updated = await membershipRepo.update(targetMembership.id, { role: newRole });
  void activityLogRepo.create({
    actorUserId: actorId,
    departmentId,
    entityType: 'membership',
    entityId: updated.id,
    action: 'member.role_changed',
    metadata: { targetUserId, from: targetMembership.role, to: newRole },
  });
  return updated;
};

// ─── Transfer Ownership ───────────────────────────────────────

export const transferOwnership = async (
  actorId: string,
  departmentId: string,
  newOwnerId: string
): Promise<void> => {
  const actorProfile = await profileRepo.findById(actorId);
  const isGlobalAdmin = actorProfile?.role === 'ADMIN';

  let currentOwnerMembershipId: string | null = null;
  let demotedRole: DepartmentMemberRole = 'ADMIN';

  if (isGlobalAdmin) {
    // Global admin: find current OWNER (if any) to demote to MEMBER
    const currentOwner = await prisma.departmentMember.findFirst({
      where: { departmentId, role: 'OWNER', status: 'ACTIVE' },
    });
    if (currentOwner) {
      if (currentOwner.userId === newOwnerId) {
        throw new ServiceError('This member is already the OWNER of this department', 400);
      }
      currentOwnerMembershipId = currentOwner.id;
      demotedRole = 'MEMBER';
    }
  } else {
    // Regular flow: actor must be current OWNER
    if (actorId === newOwnerId) {
      throw new ServiceError('You are already the OWNER of this department', 400);
    }
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (!actorMembership || actorMembership.status !== 'ACTIVE' || actorMembership.role !== 'OWNER') {
      throw new ServiceError('Only the current OWNER can transfer ownership', 403);
    }
    currentOwnerMembershipId = actorMembership.id;
    demotedRole = 'ADMIN';
  }

  const targetMembership = await membershipRepo.findByUserAndDepartment(newOwnerId, departmentId);
  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new ServiceError('Target user is not an active member of this department', 404);
  }

  // Atomic: promote target → OWNER, demote old owner if exists
  await prisma.$transaction(async (tx) => {
    await tx.departmentMember.update({
      where: { id: targetMembership.id },
      data: { role: 'OWNER' },
    });
    if (currentOwnerMembershipId) {
      await tx.departmentMember.update({
        where: { id: currentOwnerMembershipId },
        data: { role: demotedRole },
      });
    }
  });

  void activityLogRepo.create({
    actorUserId: actorId,
    departmentId,
    entityType: 'department',
    entityId: departmentId,
    action: 'ownership.transferred',
    metadata: { to: newOwnerId, demotedTo: currentOwnerMembershipId ? demotedRole : null },
  });
};
