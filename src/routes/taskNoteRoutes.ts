import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import {
  getNotes,
  createNote,
  updateNote,
  toggleNote,
  reorderNotes,
  deleteNote,
} from '../controllers/taskNoteController';

const router = Router();

// GET /api/tasks/:taskId/notes
router.get('/tasks/:taskId/notes', protect, getNotes);

// POST /api/tasks/:taskId/notes
router.post('/tasks/:taskId/notes', protect, createNote);

// PATCH /api/tasks/:taskId/notes/reorder  ← must be before /:noteId to avoid conflict
router.patch('/tasks/:taskId/notes/reorder', protect, reorderNotes);

// PATCH /api/tasks/:taskId/notes/:noteId
router.patch('/tasks/:taskId/notes/:noteId', protect, updateNote);

// PATCH /api/tasks/:taskId/notes/:noteId/toggle
router.patch('/tasks/:taskId/notes/:noteId/toggle', protect, toggleNote);

// DELETE /api/tasks/:taskId/notes/:noteId
router.delete('/tasks/:taskId/notes/:noteId', protect, deleteNote);

export default router;
