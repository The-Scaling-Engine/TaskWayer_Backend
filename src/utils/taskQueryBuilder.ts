import { Prisma } from '@prisma/client';

export const buildPersonalTaskFilter = (profileId: string): Prisma.TaskWhereInput => ({
  profileId,
});

/**
 * Builds a scoped Prisma `where` clause for task queries.
 * - Global admin: sees all tasks
 * - Members: own tasks + dept tasks (active memberships) + project tasks (any project membership)
 * - No memberships: own tasks only
 */
export const buildScopedTaskFilter = (
  profileId: string,
  departmentIds: string[],
  projectIds: string[],
  isGlobalAdmin: boolean
): Prisma.TaskWhereInput => {
  if (isGlobalAdmin) return {};

  const orClauses: Prisma.TaskWhereInput[] = [{ profileId }];

  if (departmentIds.length > 0) {
    orClauses.push({ departmentId: { in: departmentIds } });
  }

  if (projectIds.length > 0) {
    orClauses.push({ projectId: { in: projectIds } });
  }

  return { OR: orClauses };
};
