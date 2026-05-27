import { Notification } from '@prisma/client';
import { PrismaNotificationRepository } from '../repositories/prisma/notificationRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { projectRepository } from '../repositories/prisma/projectRepository';
import { CreateNotificationData } from '../repositories/interfaces';
import * as realtimeService from './realtimeService';
import logger from '../config/logger';

const notificationRepo = new PrismaNotificationRepository();
const profileRepo = new PrismaProfileRepository();

const MENTION_REGEX = /@(\w+)/g;

// ─── Core: create + emit ──────────────────────────────────────

export const createNotification = async (
  data: CreateNotificationData
): Promise<Notification> => {
  const notification = await notificationRepo.create(data);

  // Emit realtime AFTER DB insert (DB is source of truth)
  realtimeService.emitNotification(data.userId, {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    payload: notification.payload,
    entityType: notification.entityType,
    entityId: notification.entityId,
    createdAt: notification.createdAt,
  });

  return notification;
};

// ─── Mention parsing ──────────────────────────────────────────

export const processMentions = async (
  content: string,
  taskId: string,
  commentId: string,
  departmentId: string | null,
  actorId: string,
  actorName: string | null,
  taskTitle: string
): Promise<void> => {
  const matches = [...content.matchAll(MENTION_REGEX)].map(m => m[1]);
  if (matches.length === 0) return;

  const uniqueUsernames = [...new Set(matches)] as string[];
  const actor = actorName ?? 'Someone';
  const preview = content.length > 100 ? `${content.slice(0, 100)}…` : content;

  for (const username of uniqueUsernames) {
    try {
      const mentionedUser = await profileRepo.findByUsername(username);
      if (!mentionedUser) continue;
      if (mentionedUser.id === actorId) continue; // don't self-notify

      await createNotification({
        userId: mentionedUser.id,
        type: 'MENTIONED_IN_COMMENT',
        title: `${actor} mentioned you in "${taskTitle}"`,
        message: preview,
        payload: { taskId, commentId, departmentId, actorId },
        entityType: 'comment',
        entityId: commentId,
      });
    } catch (err) {
      logger.error({ err, context: 'processMentions', username, taskId, commentId }, 'Mention notification failed');
    }
  }
};

// ─── Comment added notification ───────────────────────────────

export const notifyCommentAdded = async (
  taskOwnerId: string,
  actorId: string,
  actorName: string | null,
  taskId: string,
  commentId: string,
  departmentId: string | null,
  taskTitle: string,
  commentContent: string
): Promise<void> => {
  if (taskOwnerId === actorId) return; // don't notify self

  const actor = actorName ?? 'Someone';
  const preview = commentContent.length > 100 ? `${commentContent.slice(0, 100)}…` : commentContent;

  try {
    await createNotification({
      userId: taskOwnerId,
      type: 'COMMENT_ADDED',
      title: `${actor} commented on "${taskTitle}"`,
      message: preview,
      payload: { taskId, commentId, departmentId, actorId },
      entityType: 'comment',
      entityId: commentId,
    });
  } catch (err) {
    logger.error({ err, context: 'notifyCommentAdded', taskId, commentId }, 'Comment added notification failed');
  }
};

// ─── Read APIs ────────────────────────────────────────────────

export const getNotifications = async (
  userId: string,
  page: number,
  limit: number,
  unreadOnly: boolean
): Promise<{ notifications: Notification[]; total: number; page: number; limit: number; totalPages: number }> => {
  const { notifications, total } = await notificationRepo.findByUser(userId, page, limit, unreadOnly);
  return { notifications, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const getUnreadCount = async (userId: string): Promise<number> => {
  return notificationRepo.countUnread(userId);
};

export const markRead = async (
  notificationId: string,
  userId: string
): Promise<Notification | null> => {
  return notificationRepo.markRead(notificationId, userId);
};

export const markAllRead = async (userId: string): Promise<number> => {
  return notificationRepo.markAllRead(userId);
};

// ─── Note added notification ──────────────────────────────────

export const notifyNoteAdded = async (params: {
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  taskOwnerId: string;
  assignedTo?: string | null;
  authorId: string;
  authorName: string | null;
  noteId: string;
}): Promise<void> => {
  const { taskId, taskTitle, projectId, taskOwnerId, assignedTo, authorId, authorName, noteId } = params;
  const actor = authorName ?? 'Someone';

  const recipientIds = new Set<string>();
  recipientIds.add(taskOwnerId);
  if (assignedTo) recipientIds.add(assignedTo);

  if (projectId) {
    try {
      const memberIds = await projectRepository.getMemberIds(projectId);
      memberIds.forEach(id => recipientIds.add(id));
    } catch (err) {
      logger.error({ err, context: 'notifyNoteAdded:getMemberIds', projectId }, 'Failed to fetch project members');
    }
  }

  recipientIds.delete(authorId);

  for (const userId of recipientIds) {
    try {
      await createNotification({
        userId,
        type: 'NOTE_ADDED',
        title: `${actor} added a note to "${taskTitle}"`,
        message: taskTitle,
        payload: { taskId, projectId, authorId, noteId },
        entityType: 'task',
        entityId: taskId,
      });
    } catch (err) {
      logger.error({ err, context: 'notifyNoteAdded', taskId, userId }, 'Note added notification failed');
    }
  }
};
