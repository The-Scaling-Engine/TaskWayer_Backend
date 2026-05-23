import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { uuidParamSchema } from '../schemas/commonSchemas';
import { createTodoSchema, updateTodoSchema, reorderTodosSchema } from '../schemas/todoSchemas';
import { getTodos, createTodo, updateTodo, reorderTodos, deleteTodo } from '../controllers/todoController';

const router = Router();

router.use(protect);

router.get('/',    getTodos);
router.post('/',   validateRequest({ body: createTodoSchema }), createTodo);
router.patch('/reorder', validateRequest({ body: reorderTodosSchema }), reorderTodos);
router.patch('/:id', validateRequest({ params: uuidParamSchema, body: updateTodoSchema }), updateTodo);
router.delete('/:id', validateRequest({ params: uuidParamSchema }), deleteTodo);

export default router;
