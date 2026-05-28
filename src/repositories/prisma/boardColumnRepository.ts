import prisma from '../../config/prisma';
import { BoardColumn } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────

export interface CreateColumnData {
  projectId: string;
  name: string;
  color?: string;
  order?: number;
  isDefault?: boolean;
}

export interface UpdateColumnData {
  name?: string;
  color?: string;
}

// ─── Helpers ──────────────────────────────────────────────────

async function getMaxOrder(projectId: string): Promise<number> {
  const result = await prisma.boardColumn.aggregate({
    where: { projectId },
    _max: { order: true },
  });
  return result._max.order ?? -1;
}

// ─── Repository ───────────────────────────────────────────────

export const boardColumnRepository = {
  async getColumnsByProjectId(projectId: string): Promise<BoardColumn[]> {
    return prisma.boardColumn.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
  },

  async getColumnById(id: string): Promise<BoardColumn | null> {
    return prisma.boardColumn.findUnique({ where: { id } });
  },

  async getDefaultColumn(projectId: string): Promise<BoardColumn | null> {
    return prisma.boardColumn.findFirst({
      where: { projectId, isDefault: true },
    });
  },

  async createColumn(data: CreateColumnData): Promise<BoardColumn> {
    const order = data.order ?? (await getMaxOrder(data.projectId)) + 1;
    return prisma.boardColumn.create({
      data: {
        projectId: data.projectId,
        name:      data.name,
        color:     data.color ?? '#94a3b8',
        order,
        isDefault: data.isDefault ?? false,
      },
    });
  },

  async updateColumn(id: string, data: UpdateColumnData): Promise<BoardColumn> {
    return prisma.boardColumn.update({ where: { id }, data });
  },

  async deleteColumn(id: string, defaultColumnId: string): Promise<void> {
    await prisma.$transaction([
      prisma.task.updateMany({
        where: { columnId: id },
        data:  { columnId: defaultColumnId },
      }),
      prisma.boardColumn.delete({ where: { id } }),
    ]);
  },

  async reorderColumns(updates: { id: string; order: number }[]): Promise<void> {
    await prisma.$transaction(
      updates.map(({ id, order }) =>
        prisma.boardColumn.update({ where: { id }, data: { order } })
      )
    );
  },

  async setDefaultColumn(columnId: string): Promise<void> {
    await prisma.boardColumn.update({ where: { id: columnId }, data: { isDefault: true } });
  },

  async seedDefaultColumns(projectId: string): Promise<void> {
    await prisma.boardColumn.createMany({
      data: [
        { projectId, name: 'To Do',       color: '#3b82f6', order: 0, isDefault: true  },
        { projectId, name: 'In Progress', color: '#FE812C', order: 1, isDefault: false },
        { projectId, name: 'Done',        color: '#22c55e', order: 2, isDefault: false },
      ],
    });
  },
};
