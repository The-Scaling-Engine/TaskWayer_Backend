import { registry, z } from '../registry';
import { bearerSecurity, errorResponses } from '../components';
import { createTodoSchema, updateTodoSchema, reorderTodosSchema } from '../../schemas/todoSchemas';
import { uuidParamSchema } from '../../schemas/commonSchemas';

const TodoSchema = z.object({
  id:        z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  profileId: z.string().uuid(),
  text:      z.string().openapi({ example: 'Send invoice to finance team' }),
  done:      z.boolean().openapi({ example: false }),
  tags:      z.array(z.string()).openapi({ example: ['marketing', 'finance'] }),
  order:     z.number().int().openapi({ example: 0 }),
  createdAt: z.string().openapi({ example: '2026-05-22T08:00:00.000Z' }),
  updatedAt: z.string().openapi({ example: '2026-05-22T08:00:00.000Z' }),
}).openapi('Todo');

// GET /api/todos
registry.registerPath({
  method: 'get',
  path: '/api/todos',
  tags: ['Todos'],
  summary: 'Get all quick todos',
  description: 'Returns all quick todos for the authenticated user, ordered by done (undone first) then createdAt descending.',
  security: bearerSecurity,
  responses: {
    200: {
      description: 'List of todos',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count:   z.number().openapi({ example: 3 }),
            data:    z.array(TodoSchema),
          }),
        },
      },
    },
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// POST /api/todos
registry.registerPath({
  method: 'post',
  path: '/api/todos',
  tags: ['Todos'],
  summary: 'Create a quick todo',
  description: 'Creates a new quick todo for the authenticated user.',
  security: bearerSecurity,
  request: { body: { content: { 'application/json': { schema: createTodoSchema } } } },
  responses: {
    201: {
      description: 'Todo created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Todo created' }),
            data:    TodoSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// PATCH /api/todos/:id
registry.registerPath({
  method: 'patch',
  path: '/api/todos/{id}',
  tags: ['Todos'],
  summary: 'Update a todo',
  description: 'Update the text and/or done status of a todo. At least one field must be provided. Only the owner can update.',
  security: bearerSecurity,
  request: {
    params: uuidParamSchema,
    body: { content: { 'application/json': { schema: updateTodoSchema } } },
  },
  responses: {
    200: {
      description: 'Todo updated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Todo updated' }),
            data:    TodoSchema,
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

// PATCH /api/todos/reorder
registry.registerPath({
  method: 'patch',
  path: '/api/todos/reorder',
  tags: ['Todos'],
  summary: 'Reorder todos',
  description: 'Update the order of multiple todos at once. Only affects todos owned by the authenticated user.',
  security: bearerSecurity,
  request: { body: { content: { 'application/json': { schema: reorderTodosSchema } } } },
  responses: {
    200: {
      description: 'Todos reordered',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Todos reordered' }),
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// DELETE /api/todos/:id
registry.registerPath({
  method: 'delete',
  path: '/api/todos/{id}',
  tags: ['Todos'],
  summary: 'Delete a todo',
  description: 'Permanently deletes a todo. Only the owner can delete.',
  security: bearerSecurity,
  request: { params: uuidParamSchema },
  responses: {
    200: {
      description: 'Todo deleted',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string().openapi({ example: 'Todo deleted' }),
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
