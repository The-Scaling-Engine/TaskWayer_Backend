import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { taskWriteLimiter } from '../middleware/rateLimiter';
import { createTask, getTasks, updateTask, deleteTask, getTaskStats, cancelRecurrence, cancelFromDate, bulkCreateTasks, listSubtasks, createSubtask, updateSubtask, deleteSubtask, moveSubtask } from '../controllers/taskController';
import { createTaskSchema, updateTaskSchema, getTasksQuerySchema, cancelRecurrenceSchema, cancelFromDateSchema, bulkCreateSchema, createSubtaskSchema, updateSubtaskSchema, moveSubtaskSchema, subtaskParamsSchema } from '../schemas/taskSchemas';
import { uuidParamSchema } from '../schemas/commonSchemas';

const router = Router();

// All task routes are protected
router.use(protect);

// POST /api/tasks/bulk  — must be BEFORE /:id routes
router.post('/bulk', taskWriteLimiter, validateRequest({ body: bulkCreateSchema }), bulkCreateTasks);

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

// POST /api/tasks/:id/cancel-from
router.post('/:id/cancel-from', taskWriteLimiter, validateRequest({ params: uuidParamSchema, body: cancelFromDateSchema }), cancelFromDate);

// Subtask routes — must be before /:id DELETE to avoid collision
router.get('/:id/subtasks', validateRequest({ params: uuidParamSchema }), listSubtasks);
router.post('/:id/subtasks', taskWriteLimiter, validateRequest({ params: uuidParamSchema, body: createSubtaskSchema }), createSubtask);
router.put('/:id/subtasks/:sid', taskWriteLimiter, validateRequest({ params: subtaskParamsSchema, body: updateSubtaskSchema }), updateSubtask);
router.delete('/:id/subtasks/:sid', taskWriteLimiter, validateRequest({ params: subtaskParamsSchema }), deleteSubtask);
router.post('/:id/subtasks/:sid/move', taskWriteLimiter, validateRequest({ params: subtaskParamsSchema, body: moveSubtaskSchema }), moveSubtask);

// DELETE /api/tasks/:id
router.delete('/:id', taskWriteLimiter, validateRequest({ params: uuidParamSchema }), deleteTask);

export default router;
