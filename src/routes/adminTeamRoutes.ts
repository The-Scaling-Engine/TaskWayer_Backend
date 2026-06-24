import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireManagerOrAdmin } from '../middleware/managerMiddleware';
import { getTeamOverview, getTeamOverviewTasks } from '../controllers/adminTeamController';

const router = Router();

router.use(protect, requireManagerOrAdmin);

router.get('/overview', getTeamOverview);
router.get('/overview/:profileId/tasks', getTeamOverviewTasks);

export default router;
