import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { analyticsLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { summaryQuerySchema, sessionsQuerySchema } from '../schemas/timesheetSchemas';
import { getSummaryHandler, getSessionsHandler } from '../controllers/timesheetController';

const router = Router();

router.use(protect);

router.get('/summary',  analyticsLimiter, validateRequest({ query: summaryQuerySchema }),  getSummaryHandler);
router.get('/sessions', analyticsLimiter, validateRequest({ query: sessionsQuerySchema }), getSessionsHandler);

export default router;
