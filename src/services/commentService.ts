import { Comment, Profile, Task } from '@prisma/client';
import { PrismaCommentRepository } from '../repositories/prisma/commentRepository';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { PrismaActivityLogRepository } from '../repositories/prisma/activityLogRepository';
import { resolveTaskPermission, TaskPermissionError } from '../utils/taskPermissions';
import * as notificationService from './notificationService';
import * as realtimeService from './realtimeService';
import { CommentWithReplies } from '../repositories/interfaces';
import { ServiceError } from './departmentService';
import logger from '../config/logger';

const commentRepo = new PrismaCommentRepository();
const taskRepo = new PrismaTaskRepository();
const profileRepo = new PrismaProfileRepository();
const membershipRepo = new PrismaMembershipRepository();
const activityLogRepo = new PrismaActivityLogRepository();

// ─── Permission helpers ───────────────────────────────────────

async function assertTaskReadAccess(task: Task, profileId: string, profile: Profile): Promise<void> {
  try {
    await resolveTaskPermission(task, profileId, profile, 'read', membershipRepo);
  } catch (err) {
    if (err instanceof TaskPermissionError) throw new ServiceError(err.message, err.statusCode);
    throw err;
  }
}

async function assertTaskWriteAccess(task: Task, profileId: string, profile: Profile): Promise<void> {
  try {
    await resolveTaskPermission(task, profileId, profile, 'write', membershipRepo);
  } catch (err) {
    if (err instanceof TaskPermissionError) throw new ServiceError(err.message, err.statusCode);
    throw err;
  }
}

async function assertCommentModAccess(
  comment: Comment,
  task: Task,
  profileId: string,
  profile: Profile
): Promise<void> {
  if (profile.role === 'ADMIN') return;

  // Comment author with write access
  if (comment.authorId === profileId) {
    await assertTaskWriteAccess(task, profileId, profile);
    return;
  }

  // Dept ADMIN/OWNER can moderate all comments
  if (task.departmentId) {
    const membership = await membershipRepo.findByUserAndDepartment(profileId, task.departmentId);
    if (membership?.status === 'ACTIVE' && (membership.role === 'OWNER' || membership.role === 'ADMIN')) {
      return;
    }
  }

  throw new ServiceError('Not authorized to modify this comment', 403);
}

// ─── Get comments ─────────────────────────────────────────────

export const getComments = async (
  taskId: string,
  profileId: string,
  page: number,
  limit: number
): Promise<{ comments: CommentWithReplies[]; total: number; page: number; limit: number; totalPages: number }> => {
  const task = await taskRepo.findById(taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(profileId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertTaskReadAccess(task, profileId, profile);

  const { comments, total } = await commentRepo.findByTask(taskId, page, limit);
  return { comments, total, page, limit, totalPages: Math.ceil(total / limit) };
};

// ─── Create comment ───────────────────────────────────────────

export const createComment = async (
  taskId: string,
  profileId: string,
  content: string,
  parentId?: string
): Promise<Comment> => {
  const task = await taskRepo.findById(taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(profileId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertTaskWriteAccess(task, profileId, profile);

  // Enforce depth = 1
  if (parentId) {
    const parent = await commentRepo.findParentById(parentId);
    if (!parent) throw new ServiceError('Parent comment not found', 404);
    if (parent.taskId !== taskId) throw new ServiceError('Parent comment does not belong to this task', 400);
    if (parent.parentId !== null) throw new ServiceError('Cannot reply to a reply (max depth is 1)', 400);
    if (parent.deletedAt !== null) throw new ServiceError('Cannot reply to a deleted comment', 400);
  }

  const comment = await commentRepo.create({
    taskId,
    authorId: profileId,
    content,
    ...(parentId != null && { parentId }),
  });

  // Realtime broadcast
  realtimeService.emitCommentCreated(taskId, {
    commentId: comment.id,
    taskId,
    content,
    authorId: profileId,
    authorName: profile.name,
    parentId: comment.parentId,
    createdAt: comment.createdAt,
  });

  // Notify task owner (fire-and-forget)
  void notificationService.notifyCommentAdded(
    task.profileId, profileId, profile.name, taskId, comment.id, task.departmentId,
    task.title, content
  ).catch(err => logger.error({ err, context: 'notifyCommentAdded', taskId, commentId: comment.id }, 'Fire-and-forget failed'));

  // For assigned tasks: also notify the assignee if they're not the commenter and not the same as profileId
  if (task.isAssigned && task.assignedTo && task.assignedTo !== profileId && task.assignedTo !== task.profileId) {
    void notificationService.notifyCommentAdded(
      task.assignedTo, profileId, profile.name, taskId, comment.id, task.departmentId,
      task.title, content
    ).catch(err => logger.error({ err, context: 'notifyCommentAdded:assignee', taskId, commentId: comment.id }, 'Fire-and-forget failed'));
  }

  // Parse mentions (fire-and-forget)
  void notificationService.processMentions(
    content, taskId, comment.id, task.departmentId, profileId, profile.name, task.title
  ).catch(err => logger.error({ err, context: 'processMentions', taskId, commentId: comment.id }, 'Fire-and-forget failed'));

  // Activity log (fire-and-forget)
  void activityLogRepo.create({
    actorUserId: profileId,
    ...(task.departmentId != null && { departmentId: task.departmentId }),
    entityType: 'comment',
    entityId: comment.id,
    action: 'comment.created',
    metadata: { taskId },
  }).catch(err => logger.error({ err, context: 'activityLog', action: 'comment.created' }, 'Fire-and-forget failed'));

  return comment;
};

// ─── Update comment ───────────────────────────────────────────

export const updateComment = async (
  commentId: string,
  profileId: string,
  content: string
): Promise<Comment> => {
  const comment = await commentRepo.findById(commentId);
  if (!comment) throw new ServiceError('Comment not found', 404);
  if (comment.deletedAt !== null) throw new ServiceError('Cannot edit a deleted comment', 400);

  const task = await taskRepo.findById(comment.taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(profileId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertCommentModAccess(comment, task, profileId, profile);

  const updated = await commentRepo.update(commentId, { content });

  realtimeService.emitCommentUpdated(comment.taskId, {
    commentId,
    taskId: comment.taskId,
    content,
    updatedAt: updated.updatedAt,
  });

  void activityLogRepo.create({
    actorUserId: profileId,
    ...(task.departmentId != null && { departmentId: task.departmentId }),
    entityType: 'comment',
    entityId: commentId,
    action: 'comment.updated',
    metadata: { taskId: comment.taskId },
  }).catch(err => logger.error({ err, context: 'activityLog', action: 'comment.updated' }, 'Fire-and-forget failed'));

  return updated;
};

// ─── Delete comment (soft) ────────────────────────────────────

export const deleteComment = async (
  commentId: string,
  profileId: string
): Promise<void> => {
  const comment = await commentRepo.findById(commentId);
  if (!comment) throw new ServiceError('Comment not found', 404);
  if (comment.deletedAt !== null) throw new ServiceError('Comment is already deleted', 400);

  const task = await taskRepo.findById(comment.taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(profileId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertCommentModAccess(comment, task, profileId, profile);

  await commentRepo.softDelete(commentId);

  realtimeService.emitCommentDeleted(comment.taskId, {
    commentId,
    taskId: comment.taskId,
    deleted: true,
  });

  void activityLogRepo.create({
    actorUserId: profileId,
    ...(task.departmentId != null && { departmentId: task.departmentId }),
    entityType: 'comment',
    entityId: commentId,
    action: 'comment.deleted',
    metadata: { taskId: comment.taskId },
  }).catch(err => logger.error({ err, context: 'activityLog', action: 'comment.deleted' }, 'Fire-and-forget failed'));
};
