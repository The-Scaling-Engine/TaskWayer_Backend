import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import {
  createProject,
  getMyProjects,
  getProjectById,
  updateProject,
  deleteProject,
  getMembers,
  addMember,
  removeMember,
  updateMemberRole,
  leaveProject,
  transferOwnership,
  archiveProject,
  unarchiveProject,
  linkDepartment,
  unlinkDepartment,
  getDepartments,
} from '../controllers/projectController';
import boardColumnRoutes from './boardColumnRoutes';
import slackConfigRoutes from './slackConfigRoutes';

const router = Router();

router.use(protect);

// ── Project CRUD ──────────────────────────────────────────────
// POST   /api/projects
router.post('/', createProject);

// GET    /api/projects
router.get('/', getMyProjects);

// GET    /api/projects/:id
router.get('/:id', getProjectById);

// PATCH  /api/projects/:id
router.patch('/:id', updateProject);

// DELETE /api/projects/:id
router.delete('/:id', deleteProject);

// ── Members ───────────────────────────────────────────────────
// GET    /api/projects/:id/members
router.get('/:id/members', getMembers);

// POST   /api/projects/:id/members
router.post('/:id/members', addMember);

// PATCH  /api/projects/:id/members/:profileId
router.patch('/:id/members/:profileId', updateMemberRole);

// DELETE /api/projects/:id/members/:profileId
router.delete('/:id/members/:profileId', removeMember);

// ── Lifecycle ─────────────────────────────────────────────────
// POST   /api/projects/:id/leave
router.post('/:id/leave', leaveProject);

// PATCH  /api/projects/:id/transfer-ownership
router.patch('/:id/transfer-ownership', transferOwnership);

// PATCH  /api/projects/:id/archive
router.patch('/:id/archive', archiveProject);

// PATCH  /api/projects/:id/unarchive
router.patch('/:id/unarchive', unarchiveProject);

// ── Departments ───────────────────────────────────────────────
// GET    /api/projects/:id/departments
router.get('/:id/departments', getDepartments);

// POST   /api/projects/:id/departments
router.post('/:id/departments', linkDepartment);

// DELETE /api/projects/:id/departments/:departmentId
router.delete('/:id/departments/:departmentId', unlinkDepartment);

// ── Board Columns ─────────────────────────────────────────────
// GET/POST/PATCH/DELETE /api/projects/:id/columns[/...]
router.use('/:id/columns', boardColumnRoutes);

// ── Slack Config ──────────────────────────────────────────────
// GET/PUT/DELETE /api/projects/:id/slack-config
// POST /api/projects/:id/slack-config/test
router.use('/:id/slack-config', slackConfigRoutes);

export default router;
