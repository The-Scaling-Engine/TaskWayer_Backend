import { Task, Profile } from '@prisma/client';
import { IMembershipRepository } from '../repositories/interfaces';
import { projectRepository, ProjectMemberRole } from '../repositories/prisma/projectRepository';

export class TaskPermissionError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'TaskPermissionError';
  }
}

/**
 * Validates whether a user has the required permission level on a task.
 * Single source of truth for task RBAC — reused by taskService and commentService.
 *
 * Permission priority:
 *  1. Global admin — always allowed
 *  2. Project task (task.projectId set) — uses project membership
 *  3. Department task (task.departmentId set) — uses dept membership (legacy)
 *  4. Personal task — owner only
 */
export async function resolveTaskPermission(
  task: Task,
  profileId: string,
  profile: Profile,
  level: 'read' | 'write' | 'delete',
  membershipRepo: IMembershipRepository
): Promise<void> {
  if (profile.role === 'ADMIN') return;

  // ── Project-scoped permission ──────────────────────────────
  if (task.projectId) {
    const projectMember = await projectRepository.getMember(task.projectId, profileId);

    if (!projectMember) {
      if (task.profileId !== profileId) {
        throw new TaskPermissionError('Not authorized to access this task', 403);
      }
      return;
    }

    if (level !== 'read' && projectMember.role === ProjectMemberRole.VIEWER) {
      throw new TaskPermissionError('VIEWER cannot modify tasks', 403);
    }

    if (level === 'delete') {
      if (
        projectMember.role !== ProjectMemberRole.MANAGER &&
        projectMember.role !== ProjectMemberRole.OWNER
      ) {
        throw new TaskPermissionError('Only MANAGER or OWNER can delete tasks', 403);
      }
      return;
    }

    if (
      level === 'write' &&
      projectMember.role === ProjectMemberRole.MEMBER &&
      task.profileId !== profileId &&
      task.assignedTo !== profileId
    ) {
      throw new TaskPermissionError('MEMBER can only modify their own tasks', 403);
    }

    return;
  }

  // ── Department-scoped permission (legacy) ─────────────────
  if (task.departmentId) {
    const role = await membershipRepo.getActiveMemberRole(profileId, task.departmentId);

    if (!role) {
      if (task.profileId !== profileId) {
        throw new TaskPermissionError('Not authorized to access this task', 403);
      }
      return;
    }

    if (level !== 'read' && role === 'VIEWER') {
      throw new TaskPermissionError('VIEWER cannot modify tasks', 403);
    }

    if (level !== 'read' && role === 'MEMBER' && task.profileId !== profileId && task.assignedTo !== profileId) {
      throw new TaskPermissionError('MEMBER can only modify their own tasks', 403);
    }

    return;
  }

  // ── Personal task ──────────────────────────────────────────
  if (task.profileId !== profileId) {
    throw new TaskPermissionError('Not authorized to access this task', 403);
  }
}
