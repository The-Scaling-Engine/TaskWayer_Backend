import { Prisma } from '@prisma/client';

export const buildPersonalTaskFilter = (profileId: string): Prisma.TaskWhereInput => ({
  profileId,
});

/**
 * Builds a scoped Prisma `where` clause for task queries.
 * - Global admin: sees all tasks
 * - Members: own tasks + project tasks (any project membership)
 * - No memberships: own tasks only
 *
 * Phase 3: dept-based clause removed. Task visibility is no longer granted
 * by department membership — only by personal ownership or project membership.
 */
export const buildScopedTaskFilter = (
  profileId: string,
  departmentIds: string[],
  projectIds: string[],
  isGlobalAdmin: boolean
): Prisma.TaskWhereInput => {
  if (isGlobalAdmin) return {};

  const orClauses: Prisma.TaskWhereInput[] = [{ profileId }];

  if (projectIds.length > 0) {
    orClauses.push({ projectId: { in: projectIds } });
  }

  return { OR: orClauses };
};
