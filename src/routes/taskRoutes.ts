import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { taskWriteLimiter } from '../middleware/rateLimiter';
import { createTask, getTasks, updateTask, deleteTask, getTaskStats, cancelRecurrence } from '../controllers/taskController';
import { createTaskSchema, updateTaskSchema, getTasksQuerySchema, cancelRecurrenceSchema } from '../schemas/taskSchemas';
import { uuidParamSchema } from '../schemas/commonSchemas';

const router = Router();

// All task routes are protected
router.use(protect);

// POST /api/tasks
router.post('/', taskWriteLimiter, validateRequest({ body: createTaskSchema }), createTask);

// GET /api/tasks
router.get('/', validateRequest({ query: getTasksQuerySchema }), getTasks);

// GET /api/tasks/stats
router.get('/stats', getTaskStats);

// PUT /api/tasks/:id
router.put('/:id', taskWriteLimiter, validateRequest({ params: uuidParamSchema, body: updateTaskSchema }), updateTask);

// POST /api/tasks/:id/cancel-recurrence
router.post('/:id/cancel-recurrence', taskWriteLimiter, validateRequest({ params: uuidParamSchema, body: cancelRecurrenceSchema }), cancelRecurrence);

// DELETE /api/tasks/:id
router.delete('/:id', taskWriteLimiter, validateRequest({ params: uuidParamSchema }), deleteTask);

export default router;
