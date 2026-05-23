import { registry, z } from '../registry';
import { bearerSecurity, errorResponses } from '../components';
import { createTaskSchema, updateTaskSchema, getTasksQuerySchema } from '../../schemas/taskSchemas';

const TaskSchema = z.object({
  _id: z.string().nullable().openapi({ example: '507f1f77bcf86cd799439011' }),
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  title: z.string().openapi({ example: 'Implement login feature' }),
  description: z.string().nullable().openapi({ example: 'Add JWT-based login to the API' }),
  status: z.enum(['todo', 'doing', 'done']).openapi({ example: 'todo' }),
  priority: z.enum(['low', 'medium', 'high']).openapi({ example: 'medium' }),
  tags: z.array(z.string()).openapi({ example: ['backend', 'auth'] }),
  deadline: z.string().nullable().openapi({ example: '2026-06-01T00:00:00.000Z' }),
  departmentId: z.string().uuid().nullable(),
  isAssigned: z.boolean().openapi({ example: false }),
  assignedTo: z.string().uuid().nullable(),
  assignedBy: z.string().uuid().nullable(),
  profileId: z.string().uuid(),
  createdAt: z.string().openapi({ example: '2026-05-14T00:00:00.000Z' }),
  updatedAt: z.string().openapi({ example: '2026-05-14T00:00:00.000Z' }),
}).openapi('Task');

registry.registerPath({
  method: 'post',
  path: '/api/tasks',
  tags: ['Tasks'],
  summary: 'Create a new task',
  description: 'Creates a task for the authenticated user. Optionally associates the task with a department. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createTaskSchema } },
    },
  },
  responses: {
    201: {
      description: 'Task created successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Task created successfully' }),
            data: TaskSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/tasks',
  tags: ['Tasks'],
  summary: 'Get tasks for the authenticated user',
  description: 'Returns a paginated list of tasks belonging to the authenticated user. Supports filtering by status, priority, tags, and full-text search. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    query: getTasksQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated task list',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count: z.number().openapi({ example: 10 }),
            pagination: z.object({
              page: z.number().openapi({ example: 1 }),
              limit: z.number().openapi({ example: 10 }),
              total: z.number().openapi({ example: 50 }),
              totalPages: z.number().openapi({ example: 5 }),
            }),
            data: z.array(TaskSchema),
          }),
        },
      },
    },
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/tasks/stats',
  tags: ['Tasks'],
  summary: 'Get task statistics for the authenticated user',
  description: 'Returns aggregated task counts grouped by status (todo, doing, done) for the authenticated user. Requires User or Admin role.',
  security: bearerSecurity,
  responses: {
    200: {
      description: 'Task statistics',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              todo: z.number().openapi({ example: 5 }),
              doing: z.number().openapi({ example: 3 }),
              done: z.number().openapi({ example: 12 }),
              total: z.number().openapi({ example: 20 }),
            }),
          }),
        },
      },
    },
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/tasks/{id}',
  tags: ['Tasks'],
  summary: 'Update a task',
  description: 'Updates one or more fields of an existing task. Allowed if: (1) the caller owns the task, (2) the caller is a System Admin, or (3) the task belongs to a department and the caller is an OWNER or ADMIN of that department. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }) }),
    body: {
      required: true,
      content: { 'application/json': { schema: updateTaskSchema } },
    },
  },
  responses: {
    200: {
      description: 'Task updated successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Task updated successfully' }),
            data: TaskSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/tasks/{id}',
  tags: ['Tasks'],
  summary: 'Delete a task',
  description: 'Permanently deletes a task. Allowed if: (1) the caller owns the task, (2) the caller is a System Admin, or (3) the task belongs to a department and the caller is an OWNER or ADMIN of that department. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }) }),
  },
  responses: {
    200: {
      description: 'Task deleted successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Task deleted successfully' }),
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});
