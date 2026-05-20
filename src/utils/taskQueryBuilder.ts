import { Prisma } from '@prisma/client';

export const buildPersonalTaskFilter = (profileId: string): Prisma.TaskWhereInput => ({
  profileId,
});

/**
 * Builds a scoped Prisma `where` clause for task queries.
 * - Global admin: sees all tasks (admin has no personal task space — intentional)
 * - Members: own tasks + all tasks in departments they belong to
 * - No memberships: own tasks only
 */
export const buildScopedTaskFilter = (
  profileId: string,
  departmentIds: string[],
  isGlobalAdmin: boolean
): Prisma.TaskWhereInput => {
  if (isGlobalAdmin) return {};

  if (departmentIds.length > 0) {
    return {
      OR: [
        { profileId },
        { departmentId: { in: departmentIds } },
      ],
    };
  }

  return { profileId };
};
