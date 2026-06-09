import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as projectService from '../services/projectService';
import { ProjectMemberRole, projectRepository } from '../repositories/prisma/projectRepository';
import { ServiceError } from '../services/departmentService';
import logger from '../config/logger';
import { sendError, codeFor } from '../utils/apiResponse';
import { extractTasksFromMarkdown } from '../services/aiService';

// ─── Helpers ──────────────────────────────────────────────────

function handleError(res: Response, req: AuthRequest, error: unknown, context: string): void {
  if (error instanceof ServiceError) {
    sendError(res, req, error.statusCode, codeFor(error.statusCode), error.message);
    return;
  }
  logger.error({ err: error, requestId: req.requestId }, `${context} failed`);
  sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
}

// ─── Project CRUD ─────────────────────────────────────────────

export const createProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const { name, description } = req.body as { name: string; description?: string };
    const project = await projectService.createProject(requesterId, {
      name,
      ...(description !== undefined && { description }),
    });
    res.status(201).json({ success: true, message: 'Project created successfully', data: project });
  } catch (error) {
    handleError(res, req, error, 'createProject');
  }
};

export const getMyProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projects = await projectService.getMyProjects(requesterId);
    res.status(200).json({ success: true, count: projects.length, data: projects });
  } catch (error) {
    handleError(res, req, error, 'getMyProjects');
  }
};

export const getProjectById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const project = await projectService.getProjectById(projectId, requesterId);
    res.status(200).json({ success: true, data: project });
  } catch (error) {
    handleError(res, req, error, 'getProjectById');
  }
};

export const updateProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const { name, description, status } = req.body as { name?: string; description?: string; status?: string };
    const project = await projectService.updateProject(projectId, requesterId, {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
    });
    res.status(200).json({ success: true, message: 'Project updated successfully', data: project });
  } catch (error) {
    handleError(res, req, error, 'updateProject');
  }
};

export const deleteProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    await projectService.deleteProject(projectId, requesterId);
    res.status(200).json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    handleError(res, req, error, 'deleteProject');
  }
};

// ─── Members ──────────────────────────────────────────────────

export const getMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const members = await projectService.getProjectMembers(projectId, requesterId);
    res.status(200).json({ success: true, count: members.length, data: members });
  } catch (error) {
    handleError(res, req, error, 'getMembers');
  }
};

export const addMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const { profileId, role } = req.body as { profileId: string; role?: string };
    if (!profileId) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'profileId is required');
      return;
    }
    const member = await projectService.addMember(projectId, requesterId, profileId, role as import('../repositories/prisma/projectRepository').ProjectMemberRole | undefined);
    res.status(201).json({ success: true, message: 'Member added successfully', data: member });
  } catch (error) {
    handleError(res, req, error, 'addMember');
  }
};

export const removeMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const { id: projectId, profileId } = req.params as { id: string; profileId: string };
    await projectService.removeMember(projectId, requesterId, profileId);
    res.status(200).json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    handleError(res, req, error, 'removeMember');
  }
};

export const updateMemberRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const { id: projectId, profileId } = req.params as { id: string; profileId: string };
    const { role } = req.body as { role: string };
    if (!role) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'role is required');
      return;
    }
    const member = await projectService.updateMemberRole(
      projectId, requesterId, profileId, role as ProjectMemberRole
    );
    res.status(200).json({ success: true, message: 'Member role updated', data: member });
  } catch (error) {
    handleError(res, req, error, 'updateMemberRole');
  }
};

export const leaveProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    await projectService.leaveProject(projectId, requesterId);
    res.status(200).json({ success: true, message: 'You have left the project' });
  } catch (error) {
    handleError(res, req, error, 'leaveProject');
  }
};

export const transferOwnership = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const { newOwnerId } = req.body as { newOwnerId: string };
    if (!newOwnerId) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'newOwnerId is required');
      return;
    }
    const result = await projectService.transferOwnership(projectId, requesterId, newOwnerId);
    res.status(200).json({ success: true, message: 'Ownership transferred successfully', data: result });
  } catch (error) {
    handleError(res, req, error, 'transferOwnership');
  }
};

export const archiveProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const project = await projectService.archiveProject(projectId, requesterId);
    res.status(200).json({ success: true, message: 'Project archived', data: project });
  } catch (error) {
    handleError(res, req, error, 'archiveProject');
  }
};

export const unarchiveProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const project = await projectService.unarchiveProject(projectId, requesterId);
    res.status(200).json({ success: true, message: 'Project unarchived', data: project });
  } catch (error) {
    handleError(res, req, error, 'unarchiveProject');
  }
};

// ─── Departments ──────────────────────────────────────────────

export const linkDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const { departmentId } = req.body as { departmentId: string };
    if (!departmentId) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'departmentId is required');
      return;
    }
    const link = await projectService.linkDepartment(projectId, requesterId, departmentId);
    res.status(201).json({ success: true, message: 'Department linked successfully', data: link });
  } catch (error) {
    handleError(res, req, error, 'linkDepartment');
  }
};

export const unlinkDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const { id: projectId, departmentId } = req.params as { id: string; departmentId: string };
    await projectService.unlinkDepartment(projectId, requesterId, departmentId);
    res.status(200).json({ success: true, message: 'Department unlinked successfully' });
  } catch (error) {
    handleError(res, req, error, 'unlinkDepartment');
  }
};

export const getDepartments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    await projectService.assertProjectReadable(projectId, requesterId);
    const links = await projectRepository.getLinkedDepartments(projectId);
    res.status(200).json({ success: true, data: links });
  } catch (error) {
    handleError(res, req, error, 'getDepartments');
  }
};

export const importDepartmentMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const { departmentId } = req.body as { departmentId: string };
    if (!departmentId) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'departmentId is required');
      return;
    }
    const result = await projectService.importDepartmentMembers(projectId, requesterId, departmentId);
    const message = result.added > 0
      ? `${result.added} member(s) imported successfully`
      : 'All department members are already in this project';
    res.status(200).json({ success: true, message, data: result });
  } catch (error) {
    handleError(res, req, error, 'importDepartmentMembers');
  }
};

export const bulkAddMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId   = req.params['id'] as string;
    const { members } = req.body as { members: { profileId: string; role?: string }[] };
    if (!Array.isArray(members) || members.length === 0) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'members array is required and must not be empty');
      return;
    }
    const result = await projectService.bulkAddMembers(
      projectId,
      requesterId,
      members.map(m => ({
        profileId: m.profileId,
        ...(m.role ? { role: m.role as ProjectMemberRole } : {}),
      }))
    );
    res.status(201).json({ success: true, message: `${result.added} member(s) added`, data: result });
  } catch (error) {
    handleError(res, req, error, 'bulkAddMembers');
  }
};

export const getLinkedDeptMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId   = req.params['id'] as string;
    const data = await projectService.getLinkedDeptMembers(projectId, requesterId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    handleError(res, req, error, 'getLinkedDeptMembers');
  }
};

// ─── Import Tasks from Markdown (AI Draft) ────────────────────

export const importTasksDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user!.id;
    const projectId = req.params['id'] as string;
    const { markdown } = req.body as { markdown?: string };

    if (!markdown?.trim()) {
      sendError(res, req, 400, 'VALIDATION_ERROR', 'markdown is required');
      return;
    }

    const member = await projectRepository.getMember(projectId, requesterId);
    if (!member) {
      sendError(res, req, 403, 'FORBIDDEN', 'You are not a member of this project');
      return;
    }

    const tasks = await extractTasksFromMarkdown(markdown);
    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    if (error instanceof Error) {
      const raw = error.message;
      let parsed: { error?: { message?: string; status?: string } } = {};
      try { parsed = JSON.parse(raw); } catch { /* raw is plain text */ }
      const geminiMsg = parsed.error?.message ?? raw;
      const status = parsed.error?.status ?? '';

      if (raw.includes('GROQ_API_KEY is not configured')) {
        sendError(res, req, 503, 'AI_SERVICE_ERROR', raw);
        return;
      }
      if (geminiMsg.toLowerCase().includes('invalid api key') || geminiMsg.toLowerCase().includes('api key')) {
        sendError(res, req, 503, 'AI_KEY_INVALID', 'Groq API key invalid. Please check GROQ_API_KEY in .env.');
        return;
      }
      if (geminiMsg.includes('rate limit') || geminiMsg.includes('quota') || status === 'RESOURCE_EXHAUSTED') {
        sendError(res, req, 429, 'QUOTA_EXCEEDED', 'Groq API rate limit exceeded. Please try again later.');
        return;
      }
      if (geminiMsg.includes('overloaded') || geminiMsg.includes('high demand') || status === 'UNAVAILABLE') {
        sendError(res, req, 503, 'AI_SERVICE_UNAVAILABLE', 'AI service is temporarily overloaded. Please try again in a moment.');
        return;
      }
    }
    handleError(res, req, error, 'importTasksDraft');
  }
};
