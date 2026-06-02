import prisma from '../../config/prisma';
import { Milestone } from '@prisma/client';
import { CreateMilestoneData, UpdateMilestoneData, IMilestoneRepository } from '../interfaces';

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

  async reorder(items: { id: string; order: number }[], _projectId: string): Promise<void> {
    await prisma.$transaction(
      items.map(({ id, order }) =>
        prisma.milestone.update({ where: { id }, data: { order } })
      )
    );
  },
};
