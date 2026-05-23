import { Todo } from '@prisma/client';
import prisma from '../../config/prisma';
import { ITodoRepository, CreateTodoData, UpdateTodoData } from '../interfaces';

export class PrismaTodoRepository implements ITodoRepository {
  async findById(id: string): Promise<Todo | null> {
    return prisma.todo.findUnique({ where: { id } });
  }

  async findByProfile(profileId: string): Promise<Todo[]> {
    return prisma.todo.findMany({
      where: { profileId },
      orderBy: [{ done: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(data: CreateTodoData): Promise<Todo> {
    return prisma.todo.create({
      data: {
        profileId: data.profileId,
        text: data.text,
        tags: data.tags ?? [],
        order: data.order ?? 0,
      },
    });
  }

  async update(id: string, data: UpdateTodoData): Promise<Todo> {
    return prisma.todo.update({
      where: { id },
      data: {
        ...(data.text !== undefined && { text: data.text }),
        ...(data.done !== undefined && { done: data.done }),
        ...(data.tags !== undefined && { tags: data.tags }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.todo.delete({ where: { id } });
  }
}
