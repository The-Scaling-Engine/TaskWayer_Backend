import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { adminOnly } from '../middleware/adminMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { getDashboard, getUsers, banUser, unbanUser, createUser, resendInvite, changeUserRole } from '../controllers/adminController';
import { assignUserToDepartment, removeUserFromDepartment } from '../controllers/departmentController';
import { getUsersQuerySchema, createUserSchema, changeUserRoleSchema } from '../schemas/adminSchemas';
import { assignUserToDepartmentSchema, removeUserFromDepartmentSchema } from '../schemas/departmentSchemas';
import { uuidParamSchema } from '../schemas/commonSchemas';

const router = Router();

router.use(protect);
router.use(adminOnly);

// GET /api/admin/dashboard
router.get('/dashboard', getDashboard);

// GET /api/admin/users
router.get('/users', validateRequest({ query: getUsersQuerySchema }), getUsers);

// POST /api/admin/users
router.post('/users', validateRequest({ body: createUserSchema }), createUser);

// POST /api/admin/users/:id/resend-invite
router.post('/users/:id/resend-invite', validateRequest({ params: uuidParamSchema }), resendInvite);

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', validateRequest({ params: uuidParamSchema, body: changeUserRoleSchema }), changeUserRole);

// PATCH /api/admin/users/:id/ban
router.patch('/users/:id/ban', validateRequest({ params: uuidParamSchema }), banUser);

// PATCH /api/admin/users/:id/unban
router.patch('/users/:id/unban', validateRequest({ params: uuidParamSchema }), unbanUser);

// PATCH /api/admin/users/:id/department
router.patch('/users/:id/department', validateRequest({ body: assignUserToDepartmentSchema }), assignUserToDepartment);

// DELETE /api/admin/users/:id/department
router.delete('/users/:id/department', validateRequest({ body: removeUserFromDepartmentSchema }), removeUserFromDepartment);

export default router;
