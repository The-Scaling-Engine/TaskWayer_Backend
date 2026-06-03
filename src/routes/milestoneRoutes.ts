import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import {
  getMilestones,
  createMilestone,
  reorderMilestones,
  reorderMilestoneTasks,
  updateMilestone,
  deleteMilestone,
} from '../controllers/milestoneController';
import { createMilestoneSchema, updateMilestoneSchema, reorderMilestonesSchema, reorderMilestoneTasksSchema } from '../schemas/milestoneSchemas';
import { z } from 'zod';

// mergeParams: true — inherits :id (projectId) from projectRoutes parent
const router = Router({ mergeParams: true });

const midParams = z.object({ id: z.string().uuid(), mid: z.string().uuid() });

// GET    /api/projects/:id/milestones
router.get('/', getMilestones);

// POST   /api/projects/:id/milestones
router.post('/', validateRequest({ body: createMilestoneSchema }), createMilestone);

// PATCH  /api/projects/:id/milestones/reorder  ← must be before /:mid
router.patch('/reorder', validateRequest({ body: reorderMilestonesSchema }), reorderMilestones);

// PATCH  /api/projects/:id/milestones/:mid/tasks/reorder  ← must be before /:mid
router.patch('/:mid/tasks/reorder', validateRequest({ params: midParams, body: reorderMilestoneTasksSchema }), reorderMilestoneTasks);

// PATCH  /api/projects/:id/milestones/:mid
router.patch('/:mid', validateRequest({ params: midParams, body: updateMilestoneSchema }), updateMilestone);

// DELETE /api/projects/:id/milestones/:mid
router.delete('/:mid', validateRequest({ params: midParams }), deleteMilestone);

export default router;
