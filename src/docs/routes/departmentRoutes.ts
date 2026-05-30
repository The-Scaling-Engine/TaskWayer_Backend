import { registry, z } from '../registry';
import { bearerSecurity, errorResponses } from '../components';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  getDepartmentsQuerySchema,
  getMembersQuerySchema,
  getInvitationsQuerySchema,
  addMemberSchema,
  changeMemberRoleSchema,
  transferOwnershipSchema,
  getWorkloadQuerySchema,
  getMemberTasksQuerySchema,
} from '../../schemas/departmentSchemas';
import { sendInvitationSchema } from '../../schemas/invitationSchemas';

const adminSecurity = bearerSecurity;

const DepartmentSchema = z.object({
  id: z.string().uuid().openapi({ example: 'dept-uuid-1234' }),
  name: z.string().openapi({ example: 'Engineering' }),
  description: z.string().nullable().openapi({ example: 'Software engineering department' }),
  ownerId: z.string().uuid(),
  createdAt: z.string().openapi({ example: '2026-05-14T00:00:00.000Z' }),
  updatedAt: z.string().openapi({ example: '2026-05-14T00:00:00.000Z' }),
}).openapi('Department');

const DepartmentMemberSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  departmentId: z.string().uuid(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).openapi({ example: 'MEMBER' }),
  joinedAt: z.string(),
  profile: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().nullable(),
    username: z.string().nullable(),
    avatar: z.string().nullable(),
    jobTitle: z.string().nullable().openapi({ example: 'Senior Software Engineer' }),
  }),
}).openapi('DepartmentMember');

const InvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().openapi({ example: 'invitee@example.com' }),
  departmentId: z.string().uuid(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).openapi({ example: 'MEMBER' }),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']).openapi({ example: 'PENDING' }),
  token: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
}).openapi('Invitation');

const deptIdParam = z.object({
  departmentId: z.string().uuid().openapi({ example: 'dept-uuid-1234' }),
});

// ─── Admin Department CRUD ────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/admin/departments',
  tags: ['Admin Departments'],
  summary: 'Create a department',
  description: 'Creates a new department. The creating admin becomes the department owner. Requires Admin role.',
  security: adminSecurity,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createDepartmentSchema } },
    },
  },
  responses: {
    201: {
      description: 'Department created successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string(),
            data: DepartmentSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: errorResponses[409],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/departments',
  tags: ['Admin Departments'],
  summary: 'List all departments',
  description: 'Returns a paginated list of all departments in the system. Requires Admin role.',
  security: adminSecurity,
  request: { query: getDepartmentsQuerySchema },
  responses: {
    200: {
      description: 'Paginated department list',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count: z.number(),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
            data: z.array(DepartmentSchema),
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/departments/{id}',
  tags: ['Admin Departments'],
  summary: 'Get a department by ID',
  description: 'Returns full details of a specific department including member count. Requires Admin role.',
  security: adminSecurity,
  request: {
    params: z.object({ id: z.string().uuid().openapi({ example: 'dept-uuid-1234' }) }),
  },
  responses: {
    200: {
      description: 'Department details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: DepartmentSchema,
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

registry.registerPath({
  method: 'patch',
  path: '/api/admin/departments/{id}',
  tags: ['Admin Departments'],
  summary: 'Update a department',
  description: 'Updates the name or description of an existing department. Requires Admin role.',
  security: adminSecurity,
  request: {
    params: z.object({ id: z.string().uuid().openapi({ example: 'dept-uuid-1234' }) }),
    body: {
      required: true,
      content: { 'application/json': { schema: updateDepartmentSchema } },
    },
  },
  responses: {
    200: {
      description: 'Department updated successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string(),
            data: DepartmentSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/departments/{id}',
  tags: ['Admin Departments'],
  summary: 'Delete a department',
  description: 'Deletes a department. Use ?force=true to delete even when members exist. Requires Admin role.',
  security: adminSecurity,
  request: {
    params: z.object({ id: z.string().uuid().openapi({ example: 'dept-uuid-1234' }) }),
    query: z.object({
      force: z.string().optional().openapi({ description: 'Set to "true" to force-delete a department with members', example: 'true' }),
    }),
  },
  responses: {
    200: {
      description: 'Department deleted successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), message: z.string() }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

// ─── Department Member Management ─────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/departments/{departmentId}/members',
  tags: ['Department Members'],
  summary: 'List department members',
  description: 'Returns a paginated list of members in a department. Accessible to any member of the department. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    params: deptIdParam,
    query: getMembersQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated member list',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count: z.number(),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
            data: z.array(DepartmentMemberSchema),
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

registry.registerPath({
  method: 'post',
  path: '/api/departments/{departmentId}/members',
  tags: ['Department Members'],
  summary: 'Add a member to a department',
  description: 'Adds a user to a department with an optional role. Requires department ADMIN or OWNER role.',
  security: bearerSecurity,
  request: {
    params: deptIdParam,
    body: {
      required: true,
      content: { 'application/json': { schema: addMemberSchema } },
    },
  },
  responses: {
    201: {
      description: 'Member added successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string(),
            data: DepartmentMemberSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/departments/{departmentId}/members/{userId}',
  tags: ['Department Members'],
  summary: 'Remove a member from a department',
  description: 'Removes a user from a department. Requires department ADMIN or OWNER role.',
  security: bearerSecurity,
  request: {
    params: z.object({
      departmentId: z.string().uuid().openapi({ example: 'dept-uuid-1234' }),
      userId: z.string().uuid().openapi({ example: 'user-uuid-5678' }),
    }),
  },
  responses: {
    200: {
      description: 'Member removed successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), message: z.string() }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/departments/{departmentId}/members/{userId}/role',
  tags: ['Department Members'],
  summary: 'Change a member\'s role',
  description: 'Updates the role of an existing department member (e.g., MEMBER → ADMIN). Requires department ADMIN or OWNER role.',
  security: bearerSecurity,
  request: {
    params: z.object({
      departmentId: z.string().uuid().openapi({ example: 'dept-uuid-1234' }),
      userId: z.string().uuid().openapi({ example: 'user-uuid-5678' }),
    }),
    body: {
      required: true,
      content: { 'application/json': { schema: changeMemberRoleSchema } },
    },
  },
  responses: {
    200: {
      description: 'Role updated successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string(),
            data: DepartmentMemberSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/departments/{departmentId}/transfer-ownership',
  tags: ['Department Members'],
  summary: 'Transfer department ownership',
  description: 'Transfers the OWNER role to another member of the department. The current owner becomes an ADMIN. Requires department OWNER role.',
  security: bearerSecurity,
  request: {
    params: deptIdParam,
    body: {
      required: true,
      content: { 'application/json': { schema: transferOwnershipSchema } },
    },
  },
  responses: {
    200: {
      description: 'Ownership transferred successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), message: z.string() }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

// ─── Workload ─────────────────────────────────────────────────

const memberUserParams = z.object({
  departmentId: z.string().uuid().openapi({ example: 'dept-uuid-1234' }),
  userId: z.string().uuid().openapi({ example: 'user-uuid-5678' }),
});

const WorkloadTaskStatsSchema = z.object({
  total:        z.number().openapi({ example: 5 }),
  todo:         z.number().openapi({ example: 2 }),
  doing:        z.number().openapi({ example: 1 }),
  done:         z.number().openapi({ example: 2 }),
  overdue:      z.number().openapi({ example: 0 }),
  highPriority: z.number().openapi({ example: 1 }),
  nearDeadline: z.number().openapi({ example: 1 }),
}).openapi('WorkloadTaskStats');

const MemberWorkloadSchema = z.object({
  memberId: z.string().uuid(),
  profile: z.object({
    id:       z.string().uuid(),
    name:     z.string().nullable(),
    email:    z.string().email(),
    username: z.string().nullable(),
    avatar:   z.string().nullable(),
    jobTitle: z.string().nullable(),
  }),
  role:             z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).openapi({ example: 'MEMBER' }),
  tasks:            WorkloadTaskStatsSchema,
  hasActiveSession: z.boolean().openapi({ example: false }),
}).openapi('MemberWorkload');

registry.registerPath({
  method: 'get',
  path: '/api/departments/{departmentId}/workload',
  tags: ['Department Members'],
  summary: 'Get department workload overview',
  description: 'Returns task stats and active session status for every active member of the department. Requires department OWNER or ADMIN role.',
  security: bearerSecurity,
  request: {
    params: deptIdParam,
    query: getWorkloadQuerySchema,
  },
  responses: {
    200: {
      description: 'Workload overview',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count: z.number(),
            pagination: z.object({
              page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number(),
            }),
            data: z.array(MemberWorkloadSchema),
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/departments/{departmentId}/members/{userId}/tasks',
  tags: ['Department Members'],
  summary: 'Get tasks of a specific member in a department',
  description: 'Returns a paginated list of tasks assigned to a specific member within this department. Supports filtering by status, priority, and deadline. Requires department OWNER or ADMIN role.',
  security: bearerSecurity,
  request: {
    params: memberUserParams,
    query: getMemberTasksQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated task list for the member',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count: z.number(),
            pagination: z.object({
              page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number(),
            }),
            data: z.array(z.object({}).passthrough()),
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

registry.registerPath({
  method: 'get',
  path: '/api/departments/{departmentId}/members/{userId}/time-tracking/active',
  tags: ['Department Members'],
  summary: 'Get active time-tracking session of a member',
  description: 'Returns the currently running time-tracking session (including task title) for a specific member. Returns hasActiveSession: false if the member is not currently tracking. Requires department OWNER or ADMIN role.',
  security: bearerSecurity,
  request: { params: memberUserParams },
  responses: {
    200: {
      description: 'Active session result',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              hasActiveSession: z.boolean().openapi({ example: false }),
              session: z.object({
                id:        z.string().uuid(),
                taskId:    z.string().uuid(),
                profileId: z.string().uuid(),
                startedAt: z.string().openapi({ example: '2026-05-15T08:30:00.000Z' }),
                task:      z.object({ title: z.string().openapi({ example: 'Fix login bug' }) }),
              }).nullable(),
            }),
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

// ─── Invitations ──────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/departments/{departmentId}/invitations',
  tags: ['Invitations'],
  summary: 'Send a department invitation',
  description: 'Sends an email invitation to join a department. Requires department ADMIN or OWNER role.',
  security: bearerSecurity,
  request: {
    params: deptIdParam,
    body: {
      required: true,
      content: { 'application/json': { schema: sendInvitationSchema } },
    },
  },
  responses: {
    201: {
      description: 'Invitation sent successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string(),
            data: InvitationSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/departments/{departmentId}/invitations',
  tags: ['Invitations'],
  summary: 'List department invitations',
  description: 'Returns a paginated list of pending and past invitations for a department. Requires department ADMIN or OWNER role.',
  security: bearerSecurity,
  request: {
    params: deptIdParam,
    query: getInvitationsQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated invitation list',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            count: z.number(),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
            data: z.array(InvitationSchema),
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

registry.registerPath({
  method: 'delete',
  path: '/api/departments/{departmentId}/invitations/{invitationId}',
  tags: ['Invitations'],
  summary: 'Cancel an invitation',
  description: 'Cancels a pending invitation. Only the inviting admin or department owner can cancel. Requires department ADMIN or OWNER role.',
  security: bearerSecurity,
  request: {
    params: z.object({
      departmentId: z.string().uuid().openapi({ example: 'dept-uuid-1234' }),
      invitationId: z.string().uuid().openapi({ example: 'inv-uuid-5678' }),
    }),
  },
  responses: {
    200: {
      description: 'Invitation cancelled successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), message: z.string() }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

// ─── Invitation Accept / Reject ───────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/invitations/{token}/accept',
  tags: ['Invitations'],
  summary: 'Accept a department invitation',
  description: 'Accepts a pending invitation using the token received by email. The authenticated user\'s email must match the invited email. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    params: z.object({ token: z.string().openapi({ example: 'abc123def456...' }) }),
  },
  responses: {
    200: {
      description: 'Invitation accepted — user added to department',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            message: z.string(),
            data: DepartmentMemberSchema,
          }),
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    500: errorResponses[500],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invitations/{token}/reject',
  tags: ['Invitations'],
  summary: 'Reject a department invitation',
  description: 'Rejects a pending invitation using the token received by email. The authenticated user\'s email must match the invited email. Requires User or Admin role.',
  security: bearerSecurity,
  request: {
    params: z.object({ token: z.string().openapi({ example: 'abc123def456...' }) }),
  },
  responses: {
    200: {
      description: 'Invitation rejected',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), message: z.string() }),
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
