import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { departmentWriteLimiter } from '../middleware/rateLimiter';
import {
  attachDepartmentContext,
  requireDepartmentAccess,
  requireDepartmentAdmin,
} from '../middleware/departmentMiddleware';
import {
  listDepartmentMembers,
  addDepartmentMember,
  removeDepartmentMember,
  changeMemberRole,
  transferOwnership,
  assignTaskToMember,
} from '../controllers/departmentController';
import {
  sendInvitation,
  listInvitations,
  cancelInvitation,
} from '../controllers/invitationController';
import {
  getDepartmentWorkload,
  getMemberTasks,
  getMemberActiveSession,
} from '../controllers/workloadController';
import {
  addMemberSchema,
  changeMemberRoleSchema,
  transferOwnershipSchema,
  getMembersQuerySchema,
  getInvitationsQuerySchema,
  getWorkloadQuerySchema,
  getMemberTasksQuerySchema,
  assignTaskToMemberSchema,
} from '../schemas/departmentSchemas';
import { sendInvitationSchema } from '../schemas/invitationSchemas';

const router = Router();

router.use(protect);

// All routes require resolving department context first
router.use('/:departmentId', attachDepartmentContext);

// ─── Member management ──────────────────────────────────────

// GET    /api/departments/:departmentId/members
router.get('/:departmentId/members', requireDepartmentAccess, validateRequest({ query: getMembersQuerySchema }), listDepartmentMembers);

// POST   /api/departments/:departmentId/members
router.post('/:departmentId/members', departmentWriteLimiter, requireDepartmentAdmin, validateRequest({ body: addMemberSchema }), addDepartmentMember);

// DELETE /api/departments/:departmentId/members/:userId
router.delete('/:departmentId/members/:userId', departmentWriteLimiter, requireDepartmentAdmin, removeDepartmentMember);

// PATCH  /api/departments/:departmentId/members/:userId/role
router.patch('/:departmentId/members/:userId/role', departmentWriteLimiter, requireDepartmentAdmin, validateRequest({ body: changeMemberRoleSchema }), changeMemberRole);

// POST   /api/departments/:departmentId/transfer-ownership
router.post(
  '/:departmentId/transfer-ownership',
  departmentWriteLimiter,
  requireDepartmentAdmin,
  validateRequest({ body: transferOwnershipSchema }),
  transferOwnership
);

// ─── Workload ─────────────────────────────────────────────────

// GET /api/departments/:departmentId/workload
router.get('/:departmentId/workload', requireDepartmentAdmin, validateRequest({ query: getWorkloadQuerySchema }), getDepartmentWorkload);

// GET /api/departments/:departmentId/members/:userId/tasks
router.get('/:departmentId/members/:userId/tasks', requireDepartmentAdmin, validateRequest({ query: getMemberTasksQuerySchema }), getMemberTasks);

// POST /api/departments/:departmentId/members/:userId/assign-task
router.post('/:departmentId/members/:userId/assign-task', departmentWriteLimiter, requireDepartmentAdmin, validateRequest({ body: assignTaskToMemberSchema }), assignTaskToMember);

// GET /api/departments/:departmentId/members/:userId/time-tracking/active
router.get('/:departmentId/members/:userId/time-tracking/active', requireDepartmentAdmin, getMemberActiveSession);

// ─── Invitations (department-scoped) ─────────────────────────

// POST   /api/departments/:departmentId/invitations
router.post('/:departmentId/invitations', departmentWriteLimiter, requireDepartmentAdmin, validateRequest({ body: sendInvitationSchema }), sendInvitation);

// GET    /api/departments/:departmentId/invitations
router.get('/:departmentId/invitations', requireDepartmentAdmin, validateRequest({ query: getInvitationsQuerySchema }), listInvitations);

// DELETE /api/departments/:departmentId/invitations/:invitationId
router.delete('/:departmentId/invitations/:invitationId', departmentWriteLimiter, requireDepartmentAdmin, cancelInvitation);

export default router;
