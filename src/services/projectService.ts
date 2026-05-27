import {
  projectRepository,
  ProjectMemberRole,
  OWNER_ROLES,
  MANAGER_ROLES,
  ANY_MEMBER_ROLES,
} from '../repositories/prisma/projectRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { ServiceError } from './departmentService';
import { logProjectActivity } from './projectActivityService';

const profileRepo    = new PrismaProfileRepository();
const membershipRepo = new PrismaMembershipRepository();

// ─── Permission helpers ───────────────────────────────────────

async function assertMember(projectId: string, profileId: string, allowedRoles: ProjectMemberRole[]) {
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member) throw new ServiceError('Access denied: not a project member', 403);
  if (!allowedRoles.includes(member.role)) {
    throw new ServiceError('Access denied: insufficient project role', 403);
  }
  return member;
}

async function assertAccess(projectId: string, profileId: string) {
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member) throw new ServiceError('Project not found or access denied', 404);
  return member;
}

// ─── CRUD ─────────────────────────────────────────────────────

export const createProject = async (ownerId: string, data: { name: string; description?: string }) => {
  const name = data.name?.trim();
  if (!name) throw new ServiceError('Project name is required', 400);

  const project = await projectRepository.create({
    name,
    ownerId,
    ...(data.description?.trim() ? { description: data.description.trim() } : {}),
  });

  await logProjectActivity({
    projectId: project.id,
    actorId:   ownerId,
    action:    'PROJECT_CREATED',
    metadata:  { name: project.name },
  });

  return project;
};

export const getMyProjects = async (profileId: string, includeArchived = false) => {
  return projectRepository.findByProfileId(profileId, includeArchived);
};

export const getProjectById = async (id: string, requesterId: string) => {
  await assertAccess(id, requesterId);
  const project = await projectRepository.findById(id, true); // owner can view archived
  if (!project) throw new ServiceError('Project not found', 404);
  return project;
};

export const updateProject = async (
  id: string,
  requesterId: string,
  data: { name?: string; description?: string }
) => {
  await assertMember(id, requesterId, MANAGER_ROLES);

  const updateData: { name?: string; description?: string } = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new ServiceError('Project name cannot be empty', 400);
    updateData.name = name;
  }
  if (data.description !== undefined) {
    updateData.description = data.description.trim();
  }

  return projectRepository.update(id, updateData);
};

// Soft delete — logical deletion, irreversible via public API
export const deleteProject = async (id: string, requesterId: string) => {
  await assertMember(id, requesterId, OWNER_ROLES);

  await logProjectActivity({
    projectId: id,
    actorId:   requesterId,
    action:    'PROJECT_DELETED',
  });

  return projectRepository.softDelete(id);
};

export const archiveProject = async (id: string, requesterId: string) => {
  await assertMember(id, requesterId, MANAGER_ROLES);
  const project = await projectRepository.findById(id, true); // include archived to detect duplicate
  if (!project) throw new ServiceError('Project not found', 404);
  if (project.archivedAt) throw new ServiceError('Project is already archived', 400);

  await logProjectActivity({
    projectId: id,
    actorId:   requesterId,
    action:    'PROJECT_ARCHIVED',
  });

  return projectRepository.archive(id);
};

export const unarchiveProject = async (id: string, requesterId: string) => {
  await assertMember(id, requesterId, MANAGER_ROLES);
  const project = await projectRepository.findById(id, true);
  if (!project) throw new ServiceError('Project not found', 404);
  if (!project.archivedAt) throw new ServiceError('Project is not archived', 400);

  await logProjectActivity({
    projectId: id,
    actorId:   requesterId,
    action:    'PROJECT_UNARCHIVED',
  });

  return projectRepository.unarchive(id);
};

// ─── Ownership ────────────────────────────────────────────────

export const transferOwnership = async (
  projectId: string,
  requesterId: string,
  newOwnerId: string
) => {
  // Only current OWNER can transfer
  await assertMember(projectId, requesterId, OWNER_ROLES);

  if (requesterId === newOwnerId) {
    throw new ServiceError('New owner must be a different user', 400);
  }

  // Target must already be a project member
  const targetMember = await projectRepository.getMember(projectId, newOwnerId);
  if (!targetMember) {
    throw new ServiceError('Target user is not a project member. Add them first.', 400);
  }
  if (targetMember.role === ProjectMemberRole.OWNER) {
    throw new ServiceError('Target user is already the owner', 400);
  }

  const [, newOwnerMember] = await projectRepository.transferOwnership(
    projectId,
    requesterId,
    newOwnerId
  );

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_OWNERSHIP_TRANSFERRED',
    metadata: { fromProfileId: requesterId, toProfileId: newOwnerId },
  });

  return newOwnerMember;
};

// ─── Members ──────────────────────────────────────────────────

export const getProjectMembers = async (projectId: string, requesterId: string) => {
  await assertAccess(projectId, requesterId);
  return projectRepository.getMembers(projectId);
};

export const addMember = async (
  projectId: string,
  requesterId: string,
  targetProfileId: string,
  role: ProjectMemberRole = ProjectMemberRole.MEMBER
) => {
  await assertMember(projectId, requesterId, MANAGER_ROLES);

  const assignableRoles: ProjectMemberRole[] = [
    ProjectMemberRole.MANAGER,
    ProjectMemberRole.MEMBER,
    ProjectMemberRole.VIEWER,
  ];
  if (!assignableRoles.includes(role)) {
    throw new ServiceError(
      `Invalid role. Assignable roles: ${assignableRoles.join(', ')}`,
      400
    );
  }

  const target = await profileRepo.findById(targetProfileId);
  if (!target) throw new ServiceError('User not found', 404);

  const existing = await projectRepository.getMember(projectId, targetProfileId);
  if (existing) throw new ServiceError('User is already a project member', 409);

  const member = await projectRepository.addMember(projectId, targetProfileId, role);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_MEMBER_ADDED',
    metadata: { targetProfileId, role },
  });

  return member;
};

export const removeMember = async (
  projectId: string,
  requesterId: string,
  targetProfileId: string
) => {
  await assertMember(projectId, requesterId, MANAGER_ROLES);

  const targetMember = await projectRepository.getMember(projectId, targetProfileId);
  if (!targetMember) throw new ServiceError('Member not found in this project', 404);
  if (targetMember.role === ProjectMemberRole.OWNER) {
    throw new ServiceError('Cannot remove the project owner. Transfer ownership first.', 400);
  }

  const removed = await projectRepository.removeMember(projectId, targetProfileId);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_MEMBER_REMOVED',
    metadata: { targetProfileId },
  });

  return removed;
};

export const updateMemberRole = async (
  projectId: string,
  requesterId: string,
  targetProfileId: string,
  role: ProjectMemberRole
) => {
  // Only OWNER can change roles
  await assertMember(projectId, requesterId, OWNER_ROLES);

  const assignableRoles: ProjectMemberRole[] = [
    ProjectMemberRole.MANAGER,
    ProjectMemberRole.MEMBER,
    ProjectMemberRole.VIEWER,
  ];
  if (!assignableRoles.includes(role)) {
    throw new ServiceError(
      `Invalid role. Assignable roles: ${assignableRoles.join(', ')}`,
      400
    );
  }

  const targetMember = await projectRepository.getMember(projectId, targetProfileId);
  if (!targetMember) throw new ServiceError('Member not found in this project', 404);
  if (targetMember.role === ProjectMemberRole.OWNER) {
    throw new ServiceError('Cannot demote the project owner. Use transfer-ownership instead.', 400);
  }

  const updated = await projectRepository.updateMemberRole(projectId, targetProfileId, role);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_ROLE_CHANGED',
    metadata: { targetProfileId, oldRole: targetMember.role, newRole: role },
  });

  return updated;
};

export const leaveProject = async (projectId: string, requesterId: string) => {
  const member = await projectRepository.getMember(projectId, requesterId);
  if (!member) throw new ServiceError('You are not a member of this project', 404);

  if (member.role === ProjectMemberRole.OWNER) {
    throw new ServiceError(
      'Project owner cannot leave. Transfer ownership to another member first.',
      400
    );
  }

  const left = await projectRepository.removeMember(projectId, requesterId);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_MEMBER_LEFT',
    metadata: { role: member.role },
  });

  return left;
};

// ─── Departments ──────────────────────────────────────────────

export const linkDepartment = async (
  projectId: string,
  requesterId: string,
  departmentId: string
) => {
  await assertMember(projectId, requesterId, MANAGER_ROLES);

  // Requester must also be OWNER or ADMIN of the target department
  const deptMembership = await membershipRepo.findByUserAndDepartment(requesterId, departmentId);
  if (!deptMembership || !['OWNER', 'ADMIN'].includes(deptMembership.role)) {
    throw new ServiceError(
      'You must be a Department OWNER or ADMIN to link it to a project',
      403
    );
  }

  const existing = await projectRepository.getDepartmentLink(projectId, departmentId);
  if (existing) throw new ServiceError('Department is already linked to this project', 409);

  const link = await projectRepository.linkDepartment(projectId, departmentId);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_DEPARTMENT_LINKED',
    metadata: { departmentId },
  });

  return link;
};

export const unlinkDepartment = async (
  projectId: string,
  requesterId: string,
  departmentId: string
) => {
  await assertMember(projectId, requesterId, MANAGER_ROLES);

  const existing = await projectRepository.getDepartmentLink(projectId, departmentId);
  if (!existing) throw new ServiceError('Department is not linked to this project', 404);

  const unlinked = await projectRepository.unlinkDepartment(projectId, departmentId);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_DEPARTMENT_UNLINKED',
    metadata: { departmentId },
  });

  return unlinked;
};
