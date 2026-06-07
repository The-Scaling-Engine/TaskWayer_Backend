import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as departmentService from '../services/departmentService';
import * as membershipService from '../services/membershipService';
import logger from '../config/logger';
import { sendError, codeFor } from '../utils/apiResponse';
import type {
  CreateDepartmentInput,
  UpdateDepartmentInput,
  AddMemberInput,
  ChangeMemberRoleInput,
  TransferOwnershipInput,
  AssignUserToDepartmentInput,
  RemoveUserFromDepartmentInput,
  DeleteDepartmentQuery,
  GetDepartmentsQuery,
  GetMembersQuery,
} from '../schemas/departmentSchemas';

// ─── Department CRUD (admin) ──────────────────────────────────

export const createDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = res.locals.validated.body as CreateDepartmentInput;
    const department = await departmentService.createDepartment({
      name,
      ...(description !== undefined && { description }),
    });
    res.status(201).json({ success: true, message: 'Department created successfully', data: department });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'createDepartment failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getDepartments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit } = res.locals.validated.query as GetDepartmentsQuery;
    const result = await departmentService.getDepartments(page, limit);
    res.status(200).json({
      success: true,
      count: result.departments.length,
      pagination: {
        page:       result.page,
        limit:      result.limit,
        total:      result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
      data: result.departments,
    });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getDepartments failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getDepartmentById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['id'] as string;
    const department = await departmentService.getDepartmentById(departmentId);
    res.status(200).json({ success: true, data: department });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getDepartmentById failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const updateDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['id'] as string;
    const { name, description } = res.locals.validated.body as UpdateDepartmentInput;
    const department = await departmentService.updateDepartment(departmentId, {
      ...(name        !== undefined && { name }),
      ...(description !== undefined && { description }),
    });
    res.status(200).json({ success: true, message: 'Department updated successfully', data: department });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'updateDepartment failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const deleteDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['id'] as string;
    const { force } = res.locals.validated.query as DeleteDepartmentQuery;
    await departmentService.deleteDepartment(departmentId, force);
    res.status(200).json({ success: true, message: 'Department deleted successfully' });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'deleteDepartment failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// ─── Linkable Departments ────────────────────────────────────

export const getLinkableDepartments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profileId = req.user!.id;
    const depts = await departmentService.getLinkableDepartments(profileId);
    res.status(200).json({ success: true, data: depts });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'getLinkableDepartments failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// ─── Member Management (department RBAC) ─────────────────────

export const listDepartmentMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['departmentId'] as string;
    const { page, limit } = res.locals.validated.query as GetMembersQuery;
    const result = await membershipService.listMembers(departmentId, page, limit);
    res.status(200).json({
      success: true,
      count: result.members.length,
      pagination: {
        page:       result.page,
        limit:      result.limit,
        total:      result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
      data: result.members,
    });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'listDepartmentMembers failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const addDepartmentMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['departmentId'] as string;
    const actorId = req.user!.prismaId;
    const { userId, role } = res.locals.validated.body as AddMemberInput;
    const membership = await membershipService.addMember(actorId, departmentId, userId, role);
    res.status(201).json({ success: true, message: 'Member added successfully', data: membership });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'addDepartmentMember failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const bulkAddDepartmentMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['departmentId'] as string;
    const actorId = req.user!.prismaId;
    const { members } = req.body as { members: { userId: string; role?: string }[] };
    if (!Array.isArray(members) || members.length === 0) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'members array is required and must not be empty');
      return;
    }
    const result = await membershipService.bulkAddMembers(
      actorId, departmentId,
      members.map(m => ({ userId: m.userId, ...(m.role ? { role: m.role as import('@prisma/client').DepartmentMemberRole } : {}) }))
    );
    const message = result.added > 0 ? `${result.added} member(s) added` : 'All selected users are already members';
    res.status(201).json({ success: true, message, data: result });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'bulkAddDepartmentMembers failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const removeDepartmentMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['departmentId'] as string;
    const targetUserId = req.params['userId'] as string;
    const actorId = req.user!.prismaId;
    await membershipService.removeMember(actorId, departmentId, targetUserId);
    res.status(200).json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'removeDepartmentMember failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const changeMemberRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['departmentId'] as string;
    const targetUserId = req.params['userId'] as string;
    const actorId = req.user!.prismaId;
    const { role } = res.locals.validated.body as ChangeMemberRoleInput;
    const membership = await membershipService.changeRole(actorId, departmentId, targetUserId, role);
    res.status(200).json({ success: true, message: 'Role updated successfully', data: membership });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'changeMemberRole failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const transferOwnership = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departmentId = req.params['departmentId'] as string;
    const actorId = req.user!.prismaId;
    const { newOwnerId } = res.locals.validated.body as TransferOwnershipInput;
    await membershipService.transferOwnership(actorId, departmentId, newOwnerId);
    res.status(200).json({ success: true, message: 'Ownership transferred successfully' });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'transferOwnership failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// ─── Admin-level member assignment ───────────────────────────

export const assignUserToDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = req.params['id'] as string;
    const { departmentId, role } = res.locals.validated.body as AssignUserToDepartmentInput;
    const membership = await membershipService.adminAddMember(
      targetUserId,
      departmentId,
      role,
      req.user!.prismaId
    );
    res.status(200).json({
      success: true,
      message: 'User successfully assigned to department',
      data: membership,
    });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'assignUserToDepartment failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const removeUserFromDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = req.params['id'] as string;
    const { departmentId } = res.locals.validated.body as RemoveUserFromDepartmentInput;
    await membershipService.removeMember(req.user!.prismaId, departmentId, targetUserId);
    res.status(200).json({ success: true, message: 'User successfully removed from department' });
  } catch (error) {
    if (error instanceof departmentService.ServiceError) {
      sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
      return;
    }
    logger.error({ err: error, requestId: req.requestId }, 'removeUserFromDepartment failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
