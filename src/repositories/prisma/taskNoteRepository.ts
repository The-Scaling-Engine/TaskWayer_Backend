import prisma from '../../config/prisma';

// ─── Types ────────────────────────────────────────────────────

export interface TaskNoteWithAuthor {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  done: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string;
    avatar: string | null;
  };
}

// ─── Select helper ────────────────────────────────────────────

const noteWithAuthorSelect = {
  id: true,
  taskId: true,
  authorId: true,
  content: true,
  done: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
    },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────

async function getMaxOrder(taskId: string): Promise<number> {
  const result = await prisma.taskNote.aggregate({
    where: { taskId },
    _max: { order: true },
  });
  return result._max.order ?? -1;
}

// ─── Repository ───────────────────────────────────────────────

export const taskNoteRepository = {
  async createNote(taskId: string, authorId: string, content: string): Promise<TaskNoteWithAuthor> {
    const maxOrder = await getMaxOrder(taskId);
    return prisma.taskNote.create({
      data: { taskId, authorId, content, order: maxOrder + 1 },
      select: noteWithAuthorSelect,
    });
  },

  async getNotesByTaskId(taskId: string): Promise<TaskNoteWithAuthor[]> {
    return prisma.taskNote.findMany({
      where: { taskId },
      select: noteWithAuthorSelect,
      orderBy: [{ done: 'asc' }, { order: 'asc' }],
    });
  },

  async getNoteById(id: string): Promise<TaskNoteWithAuthor | null> {
    return prisma.taskNote.findUnique({
      where: { id },
      select: noteWithAuthorSelect,
    });
  },

  async updateNote(id: string, content: string): Promise<TaskNoteWithAuthor> {
    return prisma.taskNote.update({
      where: { id },
      data: { content },
      select: noteWithAuthorSelect,
    });
  },

  async toggleDone(id: string): Promise<TaskNoteWithAuthor> {
    const note = await prisma.taskNote.findUnique({ where: { id }, select: { done: true } });
    return prisma.taskNote.update({
      where: { id },
      data: { done: !note?.done },
      select: noteWithAuthorSelect,
    });
  },

  async reorderNotes(updates: { id: string; order: number }[]): Promise<void> {
    await prisma.$transaction(
      updates.map(({ id, order }) =>
        prisma.taskNote.update({ where: { id }, data: { order } })
      )
    );
  },

  async deleteNote(id: string): Promise<void> {
    await prisma.taskNote.delete({ where: { id } });
  },

  async getNoteAuthorId(id: string): Promise<string | null> {
    const note = await prisma.taskNote.findUnique({
      where: { id },
      select: { authorId: true },
    });
    return note?.authorId ?? null;
  },
};
