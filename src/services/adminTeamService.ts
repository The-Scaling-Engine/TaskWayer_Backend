import prisma from '../config/prisma';

export interface TeamMemberStats {
  profileId: string;
  name: string | null;
  email: string;
  avatar: string | null;
  totalTasks: number;
  todoCount: number;
  doingCount: number;
  doneCount: number;
  overdueCount: number;
  completionRate: number;
}

export async function getTeamOverviewStats(): Promise<TeamMemberStats[]> {
  const now = new Date();

  // Fetch profiles, per-status counts, and overdue counts in parallel — 3 queries total
  // instead of N+1 (previously 1 findMany + N findMany per user).
  const [profiles, statusRows, overdueRows] = await Promise.all([
    prisma.profile.findMany({
      select: { id: true, name: true, email: true, avatar: true },
      orderBy: { name: 'asc' },
    }),
    prisma.task.groupBy({
      by: ['profileId', 'status'],
      where: { parentTaskId: null },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['profileId'],
      where: {
        parentTaskId: null,
        deadline:     { lt: now },
        status:       { not: 'done' },
      },
      _count: { _all: true },
    }),
  ]);

  const statusByProfile = new Map<string, { todo: number; doing: number; done: number }>();
  for (const row of statusRows) {
    const bucket = statusByProfile.get(row.profileId) ?? { todo: 0, doing: 0, done: 0 };
    bucket[row.status as 'todo' | 'doing' | 'done'] = row._count._all;
    statusByProfile.set(row.profileId, bucket);
  }

  const overdueByProfile = new Map<string, number>();
  for (const row of overdueRows) {
    overdueByProfile.set(row.profileId, row._count._all);
  }

  return profiles.map(p => {
    const status = statusByProfile.get(p.id) ?? { todo: 0, doing: 0, done: 0 };
    const total  = status.todo + status.doing + status.done;
    return {
      profileId:      p.id,
      name:           p.name,
      email:          p.email,
      avatar:         p.avatar,
      totalTasks:     total,
      todoCount:      status.todo,
      doingCount:     status.doing,
      doneCount:      status.done,
      overdueCount:   overdueByProfile.get(p.id) ?? 0,
      completionRate: total > 0 ? Math.round((status.done / total) * 100) : 0,
    };
  });
}
