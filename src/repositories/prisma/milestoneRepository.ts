import prisma from '../../config/prisma';
import { Milestone, MilestoneStatus } from '@prisma/client';
import { CreateMilestoneData, UpdateMilestoneData, IMilestoneRepository, PlanningMilestoneItem, TimelineMilestoneRaw } from '../interfaces';

const creatorProfileSelect = {
  mongoId: true,
  name: true,
  email: true,
  avatar: true,
} as const;

async function getMaxOrder(projectId: string): Promise<number> {
  const result = await prisma.milestone.aggregate({
    where: { projectId },
    _max: { order: true },
  });
  return result._max.order ?? -1;
}

export const milestoneRepository: IMilestoneRepository = {
  async findAllByProject(projectId: string): Promise<Milestone[]> {
    return prisma.milestone.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
  },

  async findById(id: string): Promise<Milestone | null> {
    return prisma.milestone.findUnique({ where: { id } });
  },

  async create(data: CreateMilestoneData): Promise<Milestone> {
    const order = data.order ?? (await getMaxOrder(data.projectId)) + 1;
    return prisma.milestone.create({
      data: {
        projectId: data.projectId,
        title:     data.title,
        order,
        ...(data.description !== undefined && { description: data.description }),
        ...(data.startDate   !== undefined && { startDate:   data.startDate }),
        ...(data.deadline    !== undefined && { deadline:    data.deadline }),
      },
    });
  },

  async update(id: string, data: UpdateMilestoneData): Promise<Milestone> {
    return prisma.milestone.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.$transaction([
      prisma.task.updateMany({ where: { milestoneId: id }, data: { milestoneId: null, milestoneOrder: null } }),
      prisma.milestone.delete({ where: { id } }),
    ]);
  },

  async findPlanningTree(projectId: string): Promise<PlanningMilestoneItem[]> {
    return prisma.milestone.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      include: {
        tasks: {
          where: { parentTaskId: null },
          orderBy: [{ milestoneOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            subtasks: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                title: true,
                status: true,
                priority: true,
                deadline: true,
                assignedTo: true,
                parentTaskId: true,
                createdAt: true,
              },
            },
            profile: { select: creatorProfileSelect },
          },
        },
      },
    }) as Promise<PlanningMilestoneItem[]>;
  },

  async findForTimeline(projectId: string): Promise<TimelineMilestoneRaw[]> {
    const rows = await prisma.milestone.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      include: {
        tasks: {
          where: { parentTaskId: null },
          select: { status: true, deadline: true, assignedTo: true },
        },
      },
    });
    return rows as TimelineMilestoneRaw[];
  },

  async reorder(items: { id: string; order: number }[], _projectId: string): Promise<void> {
    await prisma.$transaction(
      items.map(({ id, order }) =>
        prisma.milestone.update({ where: { id }, data: { order } })
      )
    );
  },

  async reorderTasks(milestoneId: string, orderedIds: string[]): Promise<void> {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.task.update({ where: { id }, data: { milestoneOrder: index } })
      )
    );
  },

  async markCompletedIfActive(id: string): Promise<boolean> {
    const result = await prisma.milestone.updateMany({
      where: { id, status: MilestoneStatus.ACTIVE },
      data: { status: MilestoneStatus.COMPLETED, completedAt: new Date() },
    });
    return result.count > 0;
  },

  async markActiveIfCompleted(id: string): Promise<boolean> {
    const result = await prisma.milestone.updateMany({
      where: { id, status: MilestoneStatus.COMPLETED },
      data: { status: MilestoneStatus.ACTIVE, completedAt: null },
    });
    return result.count > 0;
  },
};
