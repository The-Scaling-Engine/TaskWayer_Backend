import prisma from '../../config/prisma';

export interface TimeSession {
  id:              string;
  taskId:          string;
  profileId:       string;
  startedAt:       Date;
  stoppedAt:       Date | null;
  durationSeconds: number | null;
}

export interface SessionListData {
  page:     number;
  limit:    number;
  total:    number;
  sessions: TimeSession[];
}

export interface ActiveSessionWithTask {
  id:        string;
  taskId:    string;
  profileId: string;
  startedAt: Date;
  task:      { title: string; departmentId: string | null };
}

export async function getActiveSessionWithTask(profileId: string): Promise<ActiveSessionWithTask | null> {
  return prisma.timeTrackingSession.findFirst({
    where:  { profileId, stoppedAt: null },
    select: { id: true, taskId: true, profileId: true, startedAt: true, task: { select: { title: true, departmentId: true } } },
  });
}

export async function getActiveSessionsByProfileIds(
  profileIds: string[]
): Promise<Map<string, ActiveSessionWithTask>> {
  if (profileIds.length === 0) return new Map();

  const sessions = await prisma.timeTrackingSession.findMany({
    where:  { profileId: { in: profileIds }, stoppedAt: null },
    select: { id: true, taskId: true, profileId: true, startedAt: true, task: { select: { title: true, departmentId: true } } },
  });

  const result = new Map<string, ActiveSessionWithTask>();
  for (const s of sessions) {
    result.set(s.profileId, s);
  }
  return result;
}

export async function checkTaskOwnership(profileId: string, taskId: string): Promise<boolean> {
  const task = await prisma.task.findFirst({
    where:  { id: taskId, OR: [{ profileId }, { assignedTo: profileId }] },
    select: { id: true },
  });
  return task !== null;
}

export async function findActiveSession(profileId: string): Promise<TimeSession | null> {
  return prisma.timeTrackingSession.findFirst({
    where: { profileId, stoppedAt: null },
  });
}

export async function createSession(profileId: string, taskId: string): Promise<TimeSession> {
  return prisma.timeTrackingSession.create({
    data: { taskId, profileId, startedAt: new Date() },
  });
}

export async function stopActiveSession(profileId: string): Promise<TimeSession | null> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.timeTrackingSession.findFirst({
      where: { profileId, stoppedAt: null },
    });
    if (session === null) return null;

    const stoppedAt       = new Date();
    const durationSeconds = Math.floor(
      (stoppedAt.getTime() - session.startedAt.getTime()) / 1000,
    );

    return tx.timeTrackingSession.update({
      where: { id: session.id },
      data:  { stoppedAt, durationSeconds },
    });
  });
}

export async function listSessions(
  profileId: string,
  startDate: string,
  endDate:   string,
  page:      number,
  limit:     number,
): Promise<SessionListData> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end   = new Date(`${endDate}T23:59:59.999Z`);
  const skip  = (page - 1) * limit;

  const [total, sessions] = await prisma.$transaction([
    prisma.timeTrackingSession.count({
      where: { profileId, startedAt: { gte: start, lte: end } },
    }),
    prisma.timeTrackingSession.findMany({
      where:   { profileId, startedAt: { gte: start, lte: end } },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return { page, limit, total, sessions };
}
