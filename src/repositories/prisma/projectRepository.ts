import prisma from '../../config/prisma';
import { Project, ProjectMember, ProjectDepartment, ProjectMemberRole } from '@prisma/client';

// ─── Role helpers (single source of truth) ───────────────────

export { ProjectMemberRole };
export const OWNER_ROLES: ProjectMemberRole[]   = [ProjectMemberRole.OWNER];
export const MANAGER_ROLES: ProjectMemberRole[] = [ProjectMemberRole.OWNER, ProjectMemberRole.MANAGER];
export const ANY_MEMBER_ROLES: ProjectMemberRole[] = [
  ProjectMemberRole.OWNER,
  ProjectMemberRole.MANAGER,
  ProjectMemberRole.MEMBER,
  ProjectMemberRole.VIEWER,
];

// ─── Types ────────────────────────────────────────────────────

export interface CreateProjectData {
  name: string;
  description?: string;
  ownerId: string;
}

export interface UpdateProjectData {
  name?: string;
  description?: string;
}

// ─── Internal query helpers ───────────────────────────────────

const profileSelect = {
  id: true,
  email: true,
  name: true,
  username: true,
  avatar: true,
  jobTitle: true,
};

function projectInclude() {
  return {
    members: {
      include: { profile: { select: profileSelect } },
      orderBy: [{ role: 'asc' as const }, { joinedAt: 'asc' as const }],
    },
    departments: {
      include: {
        department: { select: { id: true, name: true, description: true } },
      },
    },
    _count: { select: { tasks: true, members: true } },
  };
}

// Default filter: exclude deleted; optionally include archived
function activeFilter(includeArchived = false) {
  return {
    deletedAt: null,
    ...(!includeArchived && { archivedAt: null }),
  };
}

// ─── Repository ───────────────────────────────────────────────

export class PrismaProjectRepository {

  // ── Read ──────────────────────────────────────────────────

  async findById(id: string, includeArchived = false) {
    return prisma.project.findFirst({
      where: { id, ...activeFilter(includeArchived) },
      include: projectInclude(),
    });
  }

  async findByProfileId(profileId: string, includeArchived = false) {
    return prisma.project.findMany({
      where: {
        ...activeFilter(includeArchived),
        OR: [
          { ownerId: profileId },
          { members: { some: { profileId } } },
        ],
      },
      include: projectInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findByDepartmentId(departmentId: string, includeArchived = false) {
    return prisma.project.findMany({
      where: {
        ...activeFilter(includeArchived),
        departments: { some: { departmentId } },
      },
      include: projectInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getMember(projectId: string, profileId: string): Promise<ProjectMember | null> {
    return prisma.projectMember.findUnique({
      where: { projectId_profileId: { projectId, profileId } },
    });
  }

  async getMembers(projectId: string) {
    return prisma.projectMember.findMany({
      where: { projectId },
      include: { profile: { select: profileSelect } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  // ── Write ─────────────────────────────────────────────────

  async create(data: CreateProjectData) {
    return prisma.project.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        ownerId: data.ownerId,
        members: {
          create: { profileId: data.ownerId, role: ProjectMemberRole.OWNER },
        },
      },
      include: projectInclude(),
    });
  }

  async update(id: string, data: UpdateProjectData): Promise<Project> {
    return prisma.project.update({ where: { id }, data });
  }

  // Soft delete — irreversible logical deletion
  async softDelete(id: string): Promise<Project> {
    return prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Archive — reversible, hidden from normal lists
  async archive(id: string): Promise<Project> {
    return prisma.project.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  // Unarchive — clears archivedAt only
  async unarchive(id: string): Promise<Project> {
    return prisma.project.update({ where: { id }, data: { archivedAt: null } });
  }

  // ── Members ───────────────────────────────────────────────

  async addMember(projectId: string, profileId: string, role: ProjectMemberRole = ProjectMemberRole.MEMBER) {
    return prisma.projectMember.create({
      data: { projectId, profileId, role },
      include: { profile: { select: profileSelect } },
    });
  }

  async removeMember(projectId: string, profileId: string): Promise<ProjectMember> {
    return prisma.projectMember.delete({
      where: { projectId_profileId: { projectId, profileId } },
    });
  }

  async updateMemberRole(projectId: string, profileId: string, role: ProjectMemberRole): Promise<ProjectMember> {
    return prisma.projectMember.update({
      where: { projectId_profileId: { projectId, profileId } },
      data: { role },
    });
  }

  // Atomic ownership transfer: old OWNER → MANAGER, new OWNER → OWNER
  async transferOwnership(projectId: string, fromProfileId: string, toProfileId: string) {
    return prisma.$transaction([
      prisma.projectMember.update({
        where: { projectId_profileId: { projectId, profileId: fromProfileId } },
        data: { role: ProjectMemberRole.MANAGER },
      }),
      prisma.projectMember.update({
        where: { projectId_profileId: { projectId, profileId: toProfileId } },
        data: { role: ProjectMemberRole.OWNER },
      }),
      prisma.project.update({
        where: { id: projectId },
        data: { ownerId: toProfileId },
      }),
    ]);
  }

  // ── Departments ───────────────────────────────────────────

  async linkDepartment(projectId: string, departmentId: string): Promise<ProjectDepartment> {
    return prisma.projectDepartment.create({ data: { projectId, departmentId } });
  }

  async unlinkDepartment(projectId: string, departmentId: string): Promise<ProjectDepartment> {
    return prisma.projectDepartment.delete({
      where: { projectId_departmentId: { projectId, departmentId } },
    });
  }

  async getDepartmentLink(projectId: string, departmentId: string): Promise<ProjectDepartment | null> {
    return prisma.projectDepartment.findUnique({
      where: { projectId_departmentId: { projectId, departmentId } },
    });
  }

  async getProjectIdsForMember(profileId: string): Promise<string[]> {
    const rows = await prisma.projectMember.findMany({
      where: { profileId },
      select: { projectId: true },
    });
    return rows.map(r => r.projectId);
  }

  async getMemberIds(projectId: string): Promise<string[]> {
    const rows = await prisma.projectMember.findMany({
      where: { projectId },
      select: { profileId: true },
    });
    return rows.map(r => r.profileId);
  }
}

export const projectRepository = new PrismaProjectRepository();
