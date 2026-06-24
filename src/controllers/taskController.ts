import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { TaskService, TaskServiceError } from '../services/taskService';
import type { CreateTaskInput, UpdateTaskInput, GetTasksInput, BulkCreateInput, CreateSubtaskInput, UpdateSubtaskInput } from '../services/taskService';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import logger from '../config/logger';
import { sendError, codeFor } from '../utils/apiResponse';
import type { GetTasksQuery } from '../schemas/taskSchemas';
import { getIO } from '../socket';
import { breakdownTask } from '../services/aiService';
import prisma from '../config/prisma';
import * as notificationService from '../services/notificationService';

const taskService = new TaskService(
  new PrismaTaskRepository(),
  new PrismaProfileRepository(),
  new PrismaMembershipRepository()
);

export const bulkCreateTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await taskService.bulkCreate(
      req.user!.prismaId,
      res.locals.validated.body as BulkCreateInput
    );
    res.status(201).json({
      success: true,
      message: `${result.count} task${result.count === 1 ? '' : 's'} created successfully`,
      data: result,
    });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'bulkCreateTasks failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = res.locals.validated.body as CreateTaskInput & { targetProfileId?: string };
    const { targetProfileId, ...taskInput } = body;

    let profileId = req.user!.prismaId;
    const actorId = req.user!.prismaId;
    const isAssigning =
      !!targetProfileId &&
      (req.user!.role === 'ADMIN' || req.user!.role === 'MANAGER');

    if (isAssigning) {
      const targetProfile = await prisma.profile.findUnique({
        where: { id: targetProfileId },
        select: { id: true },
      });
      if (!targetProfile) {
        sendError(res, req, 404, 'NOT_FOUND', 'Target user not found');
        return;
      }
      profileId = targetProfile.id;
    }

    const task = await taskService.createTask(profileId, taskInput as CreateTaskInput);
    res.status(201).json({ success: true, message: 'Task created successfully', data: task });

    // Notify assignee via real-time socket (fire-and-forget)
    if (isAssigning && profileId !== actorId) {
      void (async () => {
        const actor = await prisma.profile.findUnique({
          where: { id: actorId },
          select: { name: true },
        });
        void notificationService.notifyTaskAssigned({
          assigneeId: profileId,
          actorId,
          actorName: actor?.name ?? null,
          taskId: task._id,
          taskTitle: task.title,
          projectId: task.projectId ?? '',
        });
      })();
    }
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
    const { page, limit, status, priority, search, tag, sortBy, order, deadlineFrom, deadlineTo, createdFrom, createdTo, scheduledFrom, scheduledTo, personal, assignedByMe, assignedToMe, projectId, columnId, targetProfileId } =
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
    if (projectId      !== undefined) query.projectId      = projectId;
    if (columnId       !== undefined) query.columnId       = columnId;

    let profileId = req.user!.prismaId;

    if (targetProfileId && (req.user!.role === 'ADMIN' || req.user!.role === 'MANAGER')) {
      const targetProfile = await prisma.profile.findUnique({
        where: { id: targetProfileId },
        select: { id: true },
      });
      if (targetProfile) {
        profileId = targetProfile.id;
      }
    }

    const result = await taskService.getTasks(profileId, query);
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

export const cancelFromDate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fromDate } = res.locals.validated.body as { fromDate: string };
    const result = await taskService.cancelFromDate(
      req.user!.prismaId,
      req.params['id'] as string,
      fromDate
    );
    res.status(200).json({
      success: true,
      message: `Cancelled ${result.cancelled} occurrence${result.cancelled === 1 ? '' : 's'} from ${fromDate} onwards.`,
      data: result,
    });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'cancelFromDate failed');
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

export const listSubtasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parentId = req.params['id'] as string;
    const subtasks = await taskService.listSubtasks(req.user!.prismaId, parentId);
    res.status(200).json({ success: true, count: subtasks.length, data: subtasks });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'listSubtasks failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const createSubtask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parentId = req.params['id'] as string;
    const subtask = await taskService.createSubtask(
      req.user!.prismaId,
      parentId,
      res.locals.validated.body as CreateSubtaskInput
    );
    res.status(201).json({ success: true, message: 'Subtask created successfully', data: subtask });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'createSubtask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const updateSubtask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parentId = req.params['id'] as string;
    const subtaskId = req.params['sid'] as string;
    const updated = await taskService.updateSubtask(
      req.user!.prismaId,
      parentId,
      subtaskId,
      res.locals.validated.body as UpdateSubtaskInput
    );
    res.status(200).json({ success: true, message: 'Subtask updated successfully', data: updated });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateSubtask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const deleteSubtask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await taskService.deleteSubtask(
      req.user!.prismaId,
      req.params['id'] as string,
      req.params['sid'] as string
    );
    res.status(200).json({ success: true, message: 'Subtask deleted successfully' });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteSubtask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const moveSubtask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { newParentId } = res.locals.validated.body as { newParentId: string };
    const updated = await taskService.moveSubtask(
      req.user!.prismaId,
      req.params['id'] as string,
      req.params['sid'] as string,
      newParentId
    );
    res.status(200).json({ success: true, message: 'Subtask moved successfully', data: updated });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'moveSubtask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const breakdownTaskHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params['id'] as string;
    const task = await taskService.getTaskForBreakdown(req.user!.prismaId, taskId);
    const items = await breakdownTask(task.title, task.description ?? undefined);
    res.status(200).json({ success: true, data: { items } });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    const message = error instanceof Error ? error.message : 'AI breakdown failed';
    logger.error({ err: error, requestId: req.requestId }, 'breakdownTaskHandler failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', message);
  }
};
