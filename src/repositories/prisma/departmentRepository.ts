import prisma from '../../config/prisma';
import {
  IDepartmentRepository,
  CreateDepartmentData,
  UpdateDepartmentData,
  DepartmentWithMembers,
  MemberWithProfile,
  PaginatedDepartmentsResult,
} from '../interfaces';
import { Department } from '@prisma/client';
import { buildSkip } from '../../utils/pagination';

// Members preview shown in the department list response (per department)
const LIST_MEMBER_PREVIEW = 5;
// Members shown for a single department detail response
const DETAIL_MEMBER_CAP = 50;

const memberSelect = {
  id: true,
  email: true,
  name: true,
  username: true,
  avatar: true,
  jobTitle: true,
} as const;

const membershipOrderBy = [
  { role: 'asc' as const },
  { joinedAt: 'asc' as const },
  { id: 'asc' as const },
];

export class PrismaDepartmentRepository implements IDepartmentRepository {
  // ── Read ────────────────────────────────────────────────

  async findById(id: string): Promise<Department | null> {
    return prisma.department.findUnique({ where: { id } });
  }

  async findByName(name: string): Promise<Department | null> {
    return prisma.department.findUnique({ where: { name } });
  }

  async findAll(): Promise<Department[]> {
    return prisma.department.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  async findByUserRole(userId: string, roles: string[]): Promise<{ id: string; name: string }[]> {
    return prisma.department.findMany({
      where: {
        memberships: {
          some: { userId, role: { in: roles as import('@prisma/client').DepartmentMemberRole[] }, status: 'ACTIVE' },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findWithMembers(id: string): Promise<DepartmentWithMembers | null> {
    const dept = await prisma.department.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          take: DETAIL_MEMBER_CAP,
          include: {
            member: { select: memberSelect },
          },
          orderBy: membershipOrderBy,
        },
        _count: { select: { memberships: true } },
      },
    });

    if (!dept) return null;
    return this.mapToWithMembers(dept, DETAIL_MEMBER_CAP);
  }

  async findAllWithCount(page: number, limit: number): Promise<PaginatedDepartmentsResult> {
    const skip = buildSkip(page, limit);

    const [depts, total] = await prisma.$transaction([
      prisma.department.findMany({
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          memberships: {
            where: { status: 'ACTIVE' },
            take: LIST_MEMBER_PREVIEW,
            include: {
              member: { select: memberSelect },
            },
            orderBy: membershipOrderBy,
          },
          _count: { select: { memberships: true } },
        },
      }),
      prisma.department.count(),
    ]);

    return {
      departments: depts.map(d => this.mapToWithMembers(d, LIST_MEMBER_PREVIEW)),
      total,
      page,
      limit,
    };
  }

  // ── Write ───────────────────────────────────────────────

  async create(data: CreateDepartmentData): Promise<Department> {
    return prisma.department.create({ data });
  }

  async update(id: string, data: UpdateDepartmentData): Promise<Department> {
    return prisma.department.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Department> {
    return prisma.department.delete({ where: { id } });
  }

  // ── Private helpers ─────────────────────────────────────

  private mapToWithMembers(
    dept: {
      id: string;
      name: string;
      description: string | null;
      createdAt: Date;
      updatedAt: Date;
      memberships: Array<{
        id: string;
        userId: string;
        departmentId: string;
        role: import('@prisma/client').DepartmentMemberRole;
        status: import('@prisma/client').MembershipStatus;
        joinedAt: Date;
        invitedBy: string | null;
        member: { id: string; email: string; name: string | null; username: string | null; avatar: string | null; jobTitle: string | null };
      }>;
      _count: { memberships: number };
    },
    memberCap: number
  ): DepartmentWithMembers {
    const memberships: MemberWithProfile[] = dept.memberships.map(m => ({
      id: m.id,
      userId: m.userId,
      departmentId: m.departmentId,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
      invitedBy: m.invitedBy,
      profile: m.member,
    }));

    return {
      id: dept.id,
      name: dept.name,
      description: dept.description,
      createdAt: dept.createdAt,
      updatedAt: dept.updatedAt,
      memberships,
      hasMoreMembers: dept._count.memberships > memberCap,
      _count: dept._count,
    };
  }
}
