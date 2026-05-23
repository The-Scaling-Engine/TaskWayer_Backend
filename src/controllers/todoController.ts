import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as todoService from '../services/todoService';
import { sendError, codeFor } from '../utils/apiResponse';
import logger from '../config/logger';
import type { CreateTodoInput, UpdateTodoInput } from '../schemas/todoSchemas';

// GET /api/todos
export const getTodos = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const todos = await todoService.getTodos(req.user!.prismaId);
    res.status(200).json({ success: true, count: todos.length, data: todos });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getTodos failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// POST /api/todos
export const createTodo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { text, tags } = res.locals.validated.body as CreateTodoInput;
    const todo = await todoService.createTodo(req.user!.prismaId, text, tags);
    res.status(201).json({ success: true, message: 'Todo created', data: todo });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'createTodo failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/todos/:id
export const updateTodo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const data = res.locals.validated.body as UpdateTodoInput;
    const todo = await todoService.updateTodo(id, req.user!.prismaId, data);
    res.status(200).json({ success: true, message: 'Todo updated', data: todo });
  } catch (error) {
    if (error instanceof todoService.TodoServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateTodo failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// DELETE /api/todos/:id
export const deleteTodo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    await todoService.deleteTodo(id, req.user!.prismaId);
    res.status(200).json({ success: true, message: 'Todo deleted' });
  } catch (error) {
    if (error instanceof todoService.TodoServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteTodo failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
