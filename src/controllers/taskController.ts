import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { TaskService, TaskServiceError } from '../services/taskService';
import type { CreateTaskInput, UpdateTaskInput, GetTasksInput } from '../services/taskService';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import logger from '../config/logger';
import { sendError, codeFor } from '../utils/apiResponse';
import type { GetTasksQuery } from '../schemas/taskSchemas';
import { getIO } from '../socket';

const taskService = new TaskService(
  new PrismaTaskRepository(),
  new PrismaProfileRepository(),
  new PrismaMembershipRepository()
);

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const task = await taskService.createTask(
      req.user!.prismaId,
      res.locals.validated.body as CreateTaskInput
    );
    res.status(201).json({ success: true, message: 'Task created successfully', data: task });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'createTask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, status, priority, search, tag, sortBy, order, deadlineFrom, deadlineTo, createdFrom, createdTo, scheduledFrom, scheduledTo, personal, assignedByMe, assignedToMe, departmentId, projectId } =
      res.locals.validated.query as GetTasksQuery;

    const query: GetTasksInput = { page, limit };
    if (status         !== undefined) query.status         = status;
    if (priority       !== undefined) query.priority       = priority;
    if (search         !== undefined) query.search         = search;
    if (tag            !== undefined) query.tag            = tag;
    if (sortBy         !== undefined) query.sortBy         = sortBy;
    if (order          !== undefined) query.order          = order;
    if (deadlineFrom   !== undefined) query.deadlineFrom   = deadlineFrom;
    if (deadlineTo     !== undefined) query.deadlineTo     = deadlineTo;
    if (createdFrom    !== undefined) query.createdFrom    = createdFrom;
    if (createdTo      !== undefined) query.createdTo      = createdTo;
    if (scheduledFrom  !== undefined) query.scheduledFrom  = scheduledFrom;
    if (scheduledTo    !== undefined) query.scheduledTo    = scheduledTo;
    if (personal       !== undefined) query.personal       = personal;
    if (assignedByMe   !== undefined) query.assignedByMe   = assignedByMe;
    if (assignedToMe   !== undefined) query.assignedToMe   = assignedToMe;
    if (departmentId   !== undefined) query.departmentId   = departmentId;
    if (projectId      !== undefined) query.projectId      = projectId;

    const result = await taskService.getTasks(req.user!.prismaId, query);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getTasks failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const updateTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params['id'] as string;
    const updatedTask = await taskService.updateTask(
      req.user!.prismaId,
      taskId,
      res.locals.validated.body as UpdateTaskInput
    );
    res.status(200).json({ success: true, message: 'Task updated successfully', data: updatedTask });

    getIO().to(`user:${req.user!.prismaId}`).emit('task:statusUpdated', {
      taskId,
      status: updatedTask.status,
    });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateTask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const cancelRecurrence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { keepChildren } = res.locals.validated.body as { keepChildren: boolean };
    const result = await taskService.cancelRecurrence(
      req.user!.prismaId,
      req.params['id'] as string,
      keepChildren
    );
    const copies = result.deletedCount;
    const message = keepChildren
      ? 'Recurring task cancelled. Existing copies kept.'
      : `Recurring task cancelled. ${copies} unstarted ${copies === 1 ? 'copy' : 'copies'} deleted.`;
    res.status(200).json({ success: true, message, data: result });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'cancelRecurrence failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await taskService.deleteTask(req.user!.prismaId, req.params['id'] as string);
    res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteTask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getTaskStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stats = await taskService.getTaskStats(req.user!.prismaId);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getTaskStats failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
