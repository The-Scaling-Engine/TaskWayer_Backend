import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { adminOnly } from '../middleware/adminMiddleware';
import { getTeamOverview, getTeamOverviewTasks } from '../controllers/adminTeamController';

const router = Router();

router.use(protect, adminOnly);

router.get('/overview', getTeamOverview);
router.get('/overview/:profileId/tasks', getTeamOverviewTasks);

export default router;
