import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as taskNoteService from '../services/taskNoteService';
import { ServiceError } from '../services/departmentService';
import { sendError, codeFor } from '../utils/apiResponse';
import logger from '../config/logger';

// GET /api/tasks/:taskId/notes
export const getNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params['taskId'] as string;
    const profileId = req.user!.prismaId;

    const notes = await taskNoteService.getNotes(taskId, profileId);

    res.status(200).json({ success: true, count: notes.length, data: notes });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getNotes failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// POST /api/tasks/:taskId/notes
export const createNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params['taskId'] as string;
    const profileId = req.user!.prismaId;
    const { content } = req.body as { content: string };

    const note = await taskNoteService.addNote(taskId, profileId, content);

    res.status(201).json({ success: true, message: 'Note created', data: note });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'createNote failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/tasks/:taskId/notes/:noteId
export const updateNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const noteId = req.params['noteId'] as string;
    const profileId = req.user!.prismaId;
    const { content } = req.body as { content: string };

    const note = await taskNoteService.updateNote(noteId, profileId, content);

    res.status(200).json({ success: true, message: 'Note updated', data: note });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateNote failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/tasks/:taskId/notes/:noteId/toggle
export const toggleNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const noteId = req.params['noteId'] as string;
    const profileId = req.user!.prismaId;

    const note = await taskNoteService.toggleDone(noteId, profileId);

    res.status(200).json({ success: true, message: 'Note toggled', data: note });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'toggleNote failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// PATCH /api/tasks/:taskId/notes/reorder
export const reorderNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params['taskId'] as string;
    const profileId = req.user!.prismaId;
    const { orderedIds } = req.body as { orderedIds: string[] };

    if (!Array.isArray(orderedIds)) {
      sendError(res, req, 400, 'BAD_REQUEST', 'orderedIds must be an array');
      return;
    }

    await taskNoteService.reorderNotes(taskId, profileId, orderedIds);

    res.status(200).json({ success: true, message: 'Notes reordered' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'reorderNotes failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// DELETE /api/tasks/:taskId/notes/:noteId
export const deleteNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const noteId = req.params['noteId'] as string;
    const profileId = req.user!.prismaId;

    await taskNoteService.deleteNote(noteId, profileId);

    res.status(200).json({ success: true, message: 'Note deleted' });
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteNote failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
