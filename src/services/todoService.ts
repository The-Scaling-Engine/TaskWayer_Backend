import { Todo } from '@prisma/client';
import { PrismaTodoRepository } from '../repositories/prisma/todoRepository';
import logger from '../config/logger';

export class TodoServiceError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'TodoServiceError';
  }
}

const todoRepo = new PrismaTodoRepository();

export const getTodos = async (profileId: string): Promise<Todo[]> => {
  return todoRepo.findByProfile(profileId);
};

export const createTodo = async (profileId: string, text: string): Promise<Todo> => {
  return todoRepo.create({ profileId, text });
};

export const updateTodo = async (
  id: string,
  profileId: string,
  data: { text?: string | undefined; done?: boolean | undefined }
): Promise<Todo> => {
  const todo = await todoRepo.findById(id);
  if (!todo) throw new TodoServiceError('Todo not found', 404);
  if (todo.profileId !== profileId) throw new TodoServiceError('Forbidden', 403);

  return todoRepo.update(id, data);
};

export const deleteTodo = async (id: string, profileId: string): Promise<void> => {
  const todo = await todoRepo.findById(id);
  if (!todo) throw new TodoServiceError('Todo not found', 404);
  if (todo.profileId !== profileId) throw new TodoServiceError('Forbidden', 403);

  await todoRepo.delete(id);
  logger.info({ todoId: id, profileId }, 'Todo deleted');
};
