import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { getBootstrap } from '../controllers/bootstrapController';

const router = Router();

router.use(protect);

// GET /api/me/bootstrap — aggregate for the dashboard cold-start
router.get('/bootstrap', getBootstrap);

export default router;
