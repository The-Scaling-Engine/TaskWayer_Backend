import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import {
  getMilestones,
  createMilestone,
  reorderMilestones,
  updateMilestone,
  deleteMilestone,
} from '../controllers/milestoneController';
import { createMilestoneSchema, updateMilestoneSchema, reorderMilestonesSchema } from '../schemas/milestoneSchemas';
import { uuidParamSchema } from '../schemas/commonSchemas';
import { z } from 'zod';

// mergeParams: true — inherits :id (projectId) from projectRoutes parent
const router = Router({ mergeParams: true });

// GET    /api/projects/:id/milestones
router.get('/', getMilestones);

// POST   /api/projects/:id/milestones
router.post('/', validateRequest({ body: createMilestoneSchema }), createMilestone);

// PATCH  /api/projects/:id/milestones/reorder  ← must be before /:mid
router.patch('/reorder', validateRequest({ body: reorderMilestonesSchema }), reorderMilestones);

// PATCH  /api/projects/:id/milestones/:mid
router.patch('/:mid', validateRequest({ params: z.object({ id: z.string().uuid(), mid: z.string().uuid() }), body: updateMilestoneSchema }), updateMilestone);

// DELETE /api/projects/:id/milestones/:mid
router.delete('/:mid', validateRequest({ params: z.object({ id: z.string().uuid(), mid: z.string().uuid() }) }), deleteMilestone);

export default router;
