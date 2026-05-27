import { Task, Profile } from '@prisma/client';
import { taskNoteRepository, TaskNoteWithAuthor } from '../repositories/prisma/taskNoteRepository';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { resolveTaskPermission, TaskPermissionError } from '../utils/taskPermissions';
import { ServiceError } from './departmentService';
import * as notificationService from './notificationService';
import logger from '../config/logger';

const taskRepo = new PrismaTaskRepository();
const profileRepo = new PrismaProfileRepository();
const membershipRepo = new PrismaMembershipRepository();

// ─── Permission helpers ───────────────────────────────────────

async function assertTaskReadAccess(task: Task, profileId: string, profile: Profile): Promise<void> {
  try {
    await resolveTaskPermission(task, profileId, profile, 'read', membershipRepo);
  } catch (err) {
    if (err instanceof TaskPermissionError) throw new ServiceError(err.message, err.statusCode);
    throw err;
  }
}

// ─── Service functions ────────────────────────────────────────

export const addNote = async (
  taskId: string,
  authorId: string,
  content: string
): Promise<TaskNoteWithAuthor> => {
  if (!content.trim()) throw new ServiceError('Note content cannot be empty', 400);

  const task = await taskRepo.findById(taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(authorId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertTaskReadAccess(task, authorId, profile);

  const note = await taskNoteRepository.createNote(taskId, authorId, content);

  void notificationService.notifyNoteAdded({
    taskId,
    taskTitle: task.title,
    projectId: task.projectId ?? null,
    taskOwnerId: task.profileId,
    assignedTo: task.assignedTo,
    authorId,
    authorName: profile.name,
    noteId: note.id,
  }).catch(err => logger.error({ err, context: 'addNote:notifyNoteAdded', taskId }, 'Fire-and-forget notification failed'));

  return note;
};

export const getNotes = async (
  taskId: string,
  requesterId: string
): Promise<TaskNoteWithAuthor[]> => {
  const task = await taskRepo.findById(taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(requesterId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertTaskReadAccess(task, requesterId, profile);

  return taskNoteRepository.getNotesByTaskId(taskId);
};

export const updateNote = async (
  noteId: string,
  requesterId: string,
  content: string
): Promise<TaskNoteWithAuthor> => {
  if (!content.trim()) throw new ServiceError('Note content cannot be empty', 400);

  const authorId = await taskNoteRepository.getNoteAuthorId(noteId);
  if (authorId === null) throw new ServiceError('Note not found', 404);
  if (authorId !== requesterId) throw new ServiceError('Only the author can edit this note', 403);

  return taskNoteRepository.updateNote(noteId, content);
};

export const toggleDone = async (
  noteId: string,
  requesterId: string
): Promise<TaskNoteWithAuthor> => {
  const authorId = await taskNoteRepository.getNoteAuthorId(noteId);
  if (authorId === null) throw new ServiceError('Note not found', 404);
  if (authorId !== requesterId) throw new ServiceError('Only the author can toggle this note', 403);

  return taskNoteRepository.toggleDone(noteId);
};

export const reorderNotes = async (
  taskId: string,
  requesterId: string,
  orderedIds: string[]
): Promise<void> => {
  const task = await taskRepo.findById(taskId);
  if (!task) throw new ServiceError('Task not found', 404);

  const profile = await profileRepo.findById(requesterId);
  if (!profile) throw new ServiceError('User not found', 404);

  await assertTaskReadAccess(task, requesterId, profile);

  await taskNoteRepository.reorderNotes(
    orderedIds.map((id, index) => ({ id, order: index }))
  );
};

export const deleteNote = async (
  noteId: string,
  requesterId: string
): Promise<void> => {
  const note = await taskNoteRepository.getNoteById(noteId);
  if (!note) throw new ServiceError('Note not found', 404);

  const profile = await profileRepo.findById(requesterId);
  if (!profile) throw new ServiceError('User not found', 404);

  const isAuthor = note.authorId === requesterId;
  const isAdmin = profile.role === 'ADMIN';

  if (!isAuthor && !isAdmin) {
    const task = await taskRepo.findById(note.taskId);
    const isTaskOwner = task?.profileId === requesterId;
    if (!isTaskOwner) throw new ServiceError('Not authorized to delete this note', 403);
  }

  await taskNoteRepository.deleteNote(noteId);
};
