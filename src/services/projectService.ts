import * as notificationService from './notificationService';
import logger from '../config/logger';
import prisma from '../config/prisma';
import {
  projectRepository,
  ProjectMemberRole,
} from '../repositories/prisma/projectRepository';
import { boardColumnRepository } from '../repositories/prisma/boardColumnRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { ServiceError } from './departmentService';
import { logProjectActivity } from './projectActivityService';

const profileRepo    = new PrismaProfileRepository();
const membershipRepo = new PrismaMembershipRepository();

// ─── Permission helpers ───────────────────────────────────────

async function assertOwner(projectId: string, profileId: string) {
  const project = await projectRepository.findById(projectId, true);
  if (!project) throw new ServiceError('Project not found', 404);
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member || member.role !== ProjectMemberRole.OWNER) {
    throw new ServiceError('Only the project OWNER can perform this action', 403);
  }
  return member;
}

async function isDeptManagerOfProject(projectId: string, profileId: string): Promise<boolean> {
  const deptLinks = await prisma.projectDepartment.findMany({
    where: { projectId },
    select: { departmentId: true },
  });
  if (deptLinks.length === 0) return false;
  const deptIds = deptLinks.map(d => d.departmentId);
  const match = await prisma.departmentMember.findFirst({
    where: {
      userId: profileId,
      departmentId: { in: deptIds },
      role: { in: ['OWNER', 'ADMIN'] },
      status: 'ACTIVE',
    },
  });
  return !!match;
}

export async function assertProjectReadable(projectId: string, profileId: string): Promise<void> {
  // Gate 0: deleted → 404 for everyone; archived → narrower access (no dept visibility)
  const project = await projectRepository.findById(projectId, true);
  if (!project) {
    throw new ServiceError('Project not found or access denied', 404);
  }
  if (project.archivedAt != null) {
    // Archived: only ProjectMembers + Org Admin — dept visibility excluded
    const profile = await profileRepo.findById(profileId);
    if (profile?.role === 'ADMIN') return;
    const member = await projectRepository.getMember(projectId, profileId);
    if (member) return;
    throw new ServiceError('Project not found or access denied', 404);
  }

  // Gate 1: active project — Org Admin, ProjectMember, or Dept OWNER/ADMIN
  const profile = await profileRepo.findById(profileId);
  if (profile?.role === 'ADMIN') return;
  const member = await projectRepository.getMember(projectId, profileId);
  if (member) return;
  const isDeptMgr = await isDeptManagerOfProject(projectId, profileId);
  if (isDeptMgr) return;
  throw new ServiceError('Project not found or access denied', 404);
}

export async function assertProjectMember(projectId: string, profileId: string) {
  const project = await projectRepository.findById(projectId, true);
  if (!project) throw new ServiceError('Project not found', 404);
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member) throw new ServiceError('You are not a member of this project', 403);
  return member;
}

export async function assertProjectManager(projectId: string, profileId: string, allowArchived = false) {
  const project = await projectRepository.findById(projectId, true);
  if (!project) throw new ServiceError('Project not found', 404);
  if (!allowArchived && project.archivedAt) throw new ServiceError('Project is archived', 400);
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member || !['OWNER', 'MANAGER'].includes(member.role)) {
    throw new ServiceError('This action requires project OWNER or MANAGER role', 403);
  }
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

  // Seed default columns (To Do, In Progress, Done) for new project
  await boardColumnRepository.seedDefaultColumns(project.id);

  await logProjectActivity({
    projectId: project.id,
    actorId:   ownerId,
    action:    'PROJECT_CREATED',
    metadata:  { name: project.name },
  });

  return project;
};

export const getMyProjects = async (profileId: string, includeArchived = false) => {
  const profile = await profileRepo.findById(profileId);
  const isOrgAdmin = profile?.role === 'ADMIN';

  // Fetch dept memberships ONCE — passed to findByProfileId AND used for annotation
  let managerDeptIds: string[] = [];
  if (!isOrgAdmin) {
    const deptMemberships = await prisma.departmentMember.findMany({
      where: { userId: profileId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
      select: { departmentId: true },
    });
    managerDeptIds = deptMemberships.map(m => m.departmentId);
  }

  const projects = await projectRepository.findByProfileId(profileId, { includeArchived, managerDeptIds });

  // Precedence: MEMBER > DEPARTMENT > ORG_ADMIN
  return projects.map(project => {
    let visibilitySource: 'MEMBER' | 'DEPARTMENT' | 'ORG_ADMIN';
    if (
      project.ownerId === profileId ||
      project.members?.some((m: any) => m.profileId === profileId)
    ) {
      visibilitySource = 'MEMBER';
    } else if (isOrgAdmin) {
      visibilitySource = 'ORG_ADMIN';
    } else {
      visibilitySource = 'DEPARTMENT';
    }
    return { ...project, visibilitySource };
  });
};

export const getProjectById = async (id: string, requesterId: string) => {
  await assertProjectReadable(id, requesterId);
  const project = await projectRepository.findById(id, true); // owner can view archived
  if (!project) throw new ServiceError('Project not found', 404);
  return project;
};

export const updateProject = async (
  id: string,
  requesterId: string,
  data: { name?: string; description?: string }
) => {
  await assertProjectManager(id, requesterId);

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
  await assertOwner(id, requesterId);

  await logProjectActivity({
    projectId: id,
    actorId:   requesterId,
    action:    'PROJECT_DELETED',
  });

  return projectRepository.softDelete(id);
};

export const archiveProject = async (id: string, requesterId: string) => {
  await assertProjectManager(id, requesterId, true);
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
  await assertProjectManager(id, requesterId, true);
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
  await assertOwner(projectId, requesterId);

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
  await assertProjectReadable(projectId, requesterId);
  return projectRepository.getMembers(projectId);
};

export const addMember = async (
  projectId: string,
  requesterId: string,
  targetProfileId: string,
  role: ProjectMemberRole = ProjectMemberRole.MEMBER
) => {
  await assertProjectManager(projectId, requesterId);

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

  const [member, requester, project] = await Promise.all([
    projectRepository.addMember(projectId, targetProfileId, role),
    profileRepo.findById(requesterId),
    projectRepository.findById(projectId),
  ]);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_MEMBER_ADDED',
    metadata: { targetProfileId, role },
  });

  const actorName = requester?.name ?? requester?.email ?? 'Someone';
  const projectName = project?.name ?? 'a project';

  void notificationService.createNotification({
    userId:     targetProfileId,
    type:       'PROJECT_MEMBER_JOINED',
    title:      `You've been added to "${projectName}"`,
    message:    `${actorName} added you to project "${projectName}" as ${role}.`,
    payload:    { projectId, actorId: requesterId, role },
    entityType: 'project',
    entityId:   projectId,
  }).catch(err => logger.error({ err, context: 'addMember:notification', projectId, targetProfileId }, 'Fire-and-forget failed'));

  return member;
};

export const removeMember = async (
  projectId: string,
  requesterId: string,
  targetProfileId: string
) => {
  await assertProjectManager(projectId, requesterId);

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
  const requesterMember = await projectRepository.getMember(projectId, requesterId);
  if (!requesterMember) throw new ServiceError('Access denied: not a project member', 403);

  const isOwner   = requesterMember.role === ProjectMemberRole.OWNER;
  const isManager = requesterMember.role === ProjectMemberRole.MANAGER;

  if (!isOwner && !isManager) {
    throw new ServiceError('Only OWNER or MANAGER can change member roles', 403);
  }

  const targetMember = await projectRepository.getMember(projectId, targetProfileId);
  if (!targetMember) throw new ServiceError('Member not found in this project', 404);
  if (targetMember.role === ProjectMemberRole.OWNER) {
    throw new ServiceError('Cannot demote the project owner. Use transfer-ownership instead.', 400);
  }

  // MANAGER can only assign MEMBER or VIEWER — cannot promote to MANAGER/OWNER
  const managerAssignableRoles: ProjectMemberRole[] = [ProjectMemberRole.MEMBER, ProjectMemberRole.VIEWER];
  if (isManager && !managerAssignableRoles.includes(role)) {
    throw new ServiceError('MANAGER can only assign MEMBER or VIEWER roles', 403);
  }
  // MANAGER cannot change another MANAGER's role
  if (isManager && targetMember.role === ProjectMemberRole.MANAGER) {
    throw new ServiceError('MANAGER cannot change another MANAGER\'s role', 403);
  }

  const ownerAssignableRoles: ProjectMemberRole[] = [
    ProjectMemberRole.MANAGER,
    ProjectMemberRole.MEMBER,
    ProjectMemberRole.VIEWER,
  ];
  if (isOwner && !ownerAssignableRoles.includes(role)) {
    throw new ServiceError(
      `Invalid role. Assignable roles: ${ownerAssignableRoles.join(', ')}`,
      400
    );
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
  await assertProjectManager(projectId, requesterId);

  // Check 2: Must be DEPT OWNER/ADMIN — OR Org Admin
  const profile = await profileRepo.findById(requesterId);
  if (profile?.role !== 'ADMIN') {
    const deptMembership = await membershipRepo.findByUserAndDepartment(requesterId, departmentId);
    if (!deptMembership || !['OWNER', 'ADMIN'].includes(deptMembership.role)) {
      throw new ServiceError(
        'You must be a Department OWNER or ADMIN (or Org Admin) to link this department',
        403
      );
    }
  }

  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) throw new ServiceError('Department not found', 404);

  const existing = await projectRepository.getDepartmentLink(projectId, departmentId);
  if (existing) throw new ServiceError('Department is already linked to this project', 409);

  const link = await projectRepository.linkDepartment(projectId, departmentId);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_DEPARTMENT_LINKED',
    metadata: { departmentId, departmentName: dept.name },
  });

  return link;
};

export const unlinkDepartment = async (
  projectId: string,
  requesterId: string,
  departmentId: string
) => {
  await assertProjectManager(projectId, requesterId);

  // Check 2: Must be DEPT OWNER/ADMIN — OR Org Admin (mirror linkDepartment)
  const profile = await profileRepo.findById(requesterId);
  if (profile?.role !== 'ADMIN') {
    const deptMembership = await membershipRepo.findByUserAndDepartment(requesterId, departmentId);
    if (!deptMembership || !['OWNER', 'ADMIN'].includes(deptMembership.role)) {
      throw new ServiceError(
        'You must be a Department OWNER or ADMIN (or Org Admin) to unlink this department',
        403
      );
    }
  }

  const existing = await projectRepository.getDepartmentLink(projectId, departmentId);
  if (!existing) throw new ServiceError('Department is not linked to this project', 404);

  const dept = await prisma.department.findUnique({ where: { id: departmentId } });

  await projectRepository.unlinkDepartment(projectId, departmentId);

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_DEPARTMENT_UNLINKED',
    metadata: { departmentId, departmentName: dept?.name ?? departmentId },
  });
};

export const importDepartmentMembers = async (
  projectId: string,
  requesterId: string,
  departmentId: string
): Promise<{ added: number }> => {
  await assertProjectManager(projectId, requesterId);

  const link = await projectRepository.getDepartmentLink(projectId, departmentId);
  if (!link) throw new ServiceError('Department is not linked to this project', 400);

  const deptMembers = await prisma.departmentMember.findMany({
    where: { departmentId, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (deptMembers.length === 0) return { added: 0 };

  const existingIds = await projectRepository.getMemberIds(projectId);
  const existingSet = new Set(existingIds);

  const toAdd = deptMembers
    .map(m => m.userId)
    .filter(id => !existingSet.has(id))
    .map(profileId => ({ projectId, profileId, role: ProjectMemberRole.MEMBER }));

  if (toAdd.length === 0) return { added: 0 };

  await prisma.projectMember.createMany({ data: toAdd, skipDuplicates: true });

  await logProjectActivity({
    projectId,
    actorId:  requesterId,
    action:   'PROJECT_MEMBER_ADDED',
    metadata: { bulk: true, departmentId, count: toAdd.length },
  });

  return { added: toAdd.length };
};
