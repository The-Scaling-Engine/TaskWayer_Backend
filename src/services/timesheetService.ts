import prisma from '../config/prisma';

export interface DayBucket {
  date:    string;
  seconds: number;
}

export interface ProjectBucket {
  projectId: string;
  name:      string;
  seconds:   number;
}

export interface TimesheetSummary {
  totalSeconds: number;
  byDay:        DayBucket[];
  byProject:    ProjectBucket[];
}

export interface SessionRow {
  id:              string;
  startedAt:       Date;
  stoppedAt:       Date | null;
  durationSeconds: number | null;
  task: {
    title:     string;
    projectId: string | null;
    project:   { name: string } | null;
  } | null;
}

export interface SessionsData {
  page:     number;
  limit:    number;
  total:    number;
  sessions: SessionRow[];
}

export async function getSummary(
  profileId: string,
  startDate: string,
  endDate:   string,
  projectId?: string,
): Promise<TimesheetSummary> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end   = new Date(`${endDate}T23:59:59.999Z`);

  const rows = await prisma.timeTrackingSession.findMany({
    where: {
      profileId,
      stoppedAt:       { not: null },
      durationSeconds: { not: null },
      startedAt:       { gte: start, lte: end },
      ...(projectId ? { task: { projectId } } : {}),
    },
    select: {
      durationSeconds: true,
      startedAt:       true,
      task: {
        select: {
          projectId: true,
          project:   { select: { id: true, name: true } },
        },
      },
    },
  });

  const totalSeconds = rows.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0);

  // Aggregate by calendar date (UTC)
  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const key = r.startedAt.toISOString().slice(0, 10);
    dayMap.set(key, (dayMap.get(key) ?? 0) + (r.durationSeconds ?? 0));
  }
  const byDay: DayBucket[] = Array.from(dayMap.entries())
    .map(([date, seconds]) => ({ date, seconds }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Aggregate by project (personal tasks grouped as "Personal")
  const projectMap = new Map<string, ProjectBucket>();
  for (const r of rows) {
    const proj  = r.task?.project;
    const key   = proj?.id   ?? 'personal';
    const name  = proj?.name ?? 'Personal';
    const entry = projectMap.get(key);
    if (entry) {
      entry.seconds += r.durationSeconds ?? 0;
    } else {
      projectMap.set(key, { projectId: key, name, seconds: r.durationSeconds ?? 0 });
    }
  }
  const byProject: ProjectBucket[] = Array.from(projectMap.values())
    .sort((a, b) => b.seconds - a.seconds);

  return { totalSeconds, byDay, byProject };
}

export async function getSessions(
  profileId: string,
  startDate: string,
  endDate:   string,
  page:      number,
  limit:     number,
  projectId?: string,
): Promise<SessionsData> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end   = new Date(`${endDate}T23:59:59.999Z`);
  const skip  = (page - 1) * limit;

  const where = {
    profileId,
    stoppedAt: { not: null as null },
    startedAt: { gte: start, lte: end },
    ...(projectId ? { task: { projectId } } : {}),
  };

  const [total, sessions] = await prisma.$transaction([
    prisma.timeTrackingSession.count({ where }),
    prisma.timeTrackingSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id:              true,
        startedAt:       true,
        stoppedAt:       true,
        durationSeconds: true,
        task: {
          select: {
            title:     true,
            projectId: true,
            project:   { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return { page, limit, total, sessions };
}
