import prisma from '../../config/prisma';
import { DepartmentMember, Department } from '@prisma/client';
import {
  IMembershipRepository,
  CreateMembershipData,
  UpdateMembershipData,
  MemberWithProfile,
  PaginatedMembersResult,
} from '../interfaces';
import { buildSkip } from '../../utils/pagination';

export class PrismaMembershipRepository implements IMembershipRepository {
  async findById(id: string): Promise<DepartmentMember | null> {
    return prisma.departmentMember.findUnique({ where: { id } });
  }

  async findByUserAndDepartment(
    userId: string,
    departmentId: string
  ): Promise<DepartmentMember | null> {
    return prisma.departmentMember.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
  }

  async getActiveMemberRole(
    userId: string,
    departmentId: string
  ): Promise<import('@prisma/client').DepartmentMemberRole | null> {
    const row = await prisma.departmentMember.findFirst({
      where: { userId, departmentId, status: 'ACTIVE' },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  async findActiveMembersByDepartment(
    departmentId: string,
    page: number,
    limit: number
  ): Promise<PaginatedMembersResult> {
    const skip = buildSkip(page, limit);
    const where = { departmentId, status: 'ACTIVE' as const };

    const [rows, total] = await prisma.$transaction([
      prisma.departmentMember.findMany({
        where,
        include: {
          member: {
            select: { id: true, email: true, name: true, username: true, avatar: true, jobTitle: true },
          },
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.departmentMember.count({ where }),
    ]);

    const members: MemberWithProfile[] = rows.map(r => ({
      id: r.id,
      userId: r.userId,
      departmentId: r.departmentId,
      role: r.role,
      status: r.status,
      joinedAt: r.joinedAt,
      invitedBy: r.invitedBy,
      profile: r.member,
    }));

    return { members, total, page, limit };
  }

  async findUserMemberships(
    userId: string
  ): Promise<(DepartmentMember & { department: Department })[]> {
    return prisma.departmentMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { department: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(data: CreateMembershipData): Promise<DepartmentMember> {
    return prisma.departmentMember.create({
      data: {
        userId: data.userId,
        departmentId: data.departmentId,
        role: data.role ?? 'MEMBER',
        status: data.status ?? 'ACTIVE',
        invitedBy: data.invitedBy ?? null,
      },
    });
  }

  async update(id: string, data: UpdateMembershipData): Promise<DepartmentMember> {
    return prisma.departmentMember.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.departmentMember.delete({ where: { id } });
  }

  async countActive(departmentId: string): Promise<number> {
    return prisma.departmentMember.count({
      where: { departmentId, status: 'ACTIVE' },
    });
  }

  async findActiveMembershipByUser(
    userId: string
  ): Promise<(import('@prisma/client').DepartmentMember & { department: { id: string; name: string } }) | null> {
    return prisma.departmentMember.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { department: { select: { id: true, name: true } } },
    }) as Promise<(import('@prisma/client').DepartmentMember & { department: { id: string; name: string } }) | null>;
  }
}
