import { getIO } from '../socket/index';
import logger from '../config/logger';

// ─── Comment events ───────────────────────────────────────────

export interface CommentPayload {
  commentId: string;
  taskId: string;
  content: string;
  authorId: string;
  authorName: string | null;
  parentId: string | null;
  createdAt: Date;
}

export interface CommentDeletedPayload {
  commentId: string;
  taskId: string;
  deleted: true;
}

export interface CommentUpdatedPayload {
  commentId: string;
  taskId: string;
  content: string;
  updatedAt: Date;
}

export function emitCommentCreated(taskId: string, payload: CommentPayload): void {
  try {
    getIO().to(`task:${taskId}`).emit('comment:created', payload);
  } catch (err) {
    logger.warn({ err }, 'emitCommentCreated failed');
  }
}

export function emitCommentUpdated(taskId: string, payload: CommentUpdatedPayload): void {
  try {
    getIO().to(`task:${taskId}`).emit('comment:updated', payload);
  } catch (err) {
    logger.warn({ err }, 'emitCommentUpdated failed');
  }
}

export function emitCommentDeleted(taskId: string, payload: CommentDeletedPayload): void {
  try {
    getIO().to(`task:${taskId}`).emit('comment:deleted', payload);
  } catch (err) {
    logger.warn({ err }, 'emitCommentDeleted failed');
  }
}

// ─── Notification events ──────────────────────────────────────

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  payload: unknown;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

export function emitNotification(userId: string, payload: NotificationPayload): void {
  try {
    getIO().to(`user:${userId}`).emit('notification:new', payload);
  } catch (err) {
    logger.warn({ err }, 'emitNotification failed');
  }
}

// ─── Task events ──────────────────────────────────────────────

export interface TaskUpdatedPayload {
  taskId: string;
  updatedFields: string[];
  // New field values for the keys in `updatedFields`. When present, subscribed
  // clients patch in place instead of refetching. Absent for non-service-layer
  // callers (backward-compat during rolling deploy).
  patch?: Record<string, unknown>;
  updatedAt: Date;
}

export function emitTaskUpdated(taskId: string, payload: TaskUpdatedPayload): void {
  try {
    getIO().to(`task:${taskId}`).emit('task:updated', payload);
  } catch (err) {
    logger.warn({ err }, 'emitTaskUpdated failed');
  }
}

// ─── Planning events ──────────────────────────────────────────

export interface PlanningUpdatedPayload {
  type: 'milestone_crud' | 'milestone_reordered' | 'task_milestone_changed' | 'subtask_moved' | 'milestone_completed';
  updatedAt: Date;
}

export function emitPlanningUpdated(projectId: string, payload: PlanningUpdatedPayload): void {
  try {
    getIO().to(`project:${projectId}`).emit('planning:updated', payload);
  } catch (err) {
    logger.warn({ err }, 'emitPlanningUpdated failed');
  }
}
