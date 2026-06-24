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
  const profiles = await prisma.profile.findMany({
    select: { id: true, name: true, email: true, avatar: true },
    orderBy: { name: 'asc' },
  });

  const now = new Date();

  const results = await Promise.all(
    profiles.map(async (p) => {
      const tasks = await prisma.task.findMany({
        where: { profileId: p.id, parentTaskId: null },
        select: { status: true, deadline: true },
      });

      const total = tasks.length;
      const todo  = tasks.filter(t => t.status === 'todo').length;
      const doing = tasks.filter(t => t.status === 'doing').length;
      const done  = tasks.filter(t => t.status === 'done').length;
      const overdue = tasks.filter(
        t => t.deadline && new Date(t.deadline) < now && t.status !== 'done'
      ).length;

      return {
        profileId: p.id,
        name: p.name,
        email: p.email,
        avatar: p.avatar,
        totalTasks: total,
        todoCount: todo,
        doingCount: doing,
        doneCount: done,
        overdueCount: overdue,
        completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    })
  );

  return results;
}
