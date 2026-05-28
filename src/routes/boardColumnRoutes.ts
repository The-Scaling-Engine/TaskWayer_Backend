import { Router } from 'express';
import {
  getColumns,
  createColumn,
  reorderColumns,
  updateColumn,
  deleteColumn,
} from '../controllers/boardColumnController';

// mergeParams: true — inherits :id (projectId) from projectRoutes parent
const router = Router({ mergeParams: true });

// GET    /api/projects/:id/columns
router.get('/', getColumns);

// POST   /api/projects/:id/columns
router.post('/', createColumn);

// PATCH  /api/projects/:id/columns/reorder  ← must be before /:columnId
router.patch('/reorder', reorderColumns);

// PATCH  /api/projects/:id/columns/:columnId
router.patch('/:columnId', updateColumn);

// DELETE /api/projects/:id/columns/:columnId
router.delete('/:columnId', deleteColumn);

export default router;
