import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { getProjectIdsByDepartment, getProjectIdsByDepartments } from './deptProjectHelpers';

const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Date range helpers ───────────────────────────────────────

function toUTCDateRange(startDate: string, endDate: string): { start: Date; end: Date } {
  return {
    start: new Date(`${startDate}T00:00:00.000Z`),
    end:   new Date(`${endDate}T23:59:59.999Z`),
  };
}

interface AvgResult  { avg_ms: number | null }
interface TrendRow   { day: Date; count: number }

export interface UserSummaryData {
  tasks: {
    total:   number;
    todo:    number;
    doing:   number;
    done:    number;
    overdue: number;
    dueSoon: number;
  };
  notifications: { unread: number };
  comments:      { total: number };
}

export interface AdminSummaryData {
  users: {
    total:  number;
    active: number;
    banned: number;
  };
  tasks: {
    total:        number;
    todo:         number;
    doing:        number;
    done:         number;
    overdue:      number;
    dueSoon:      number;
    createdToday: number;
  };
  departments: { total: number };
  comments:    { total: number };
}

export async function getUserSummary(profileId: string): Promise<UserSummaryData> {
  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_MS);

  const [taskGroups, overdueCount, dueSoonCount, unreadCount, commentCount] =
    await prisma.$transaction([
      prisma.task.groupBy({
        by: ['status'],
        where: { profileId },
        _count: { _all: true },
      }),
      prisma.task.count({
        where: {
          profileId,
          status:   { not: 'done' },
          deadline: { lt: now },
        },
      }),
      prisma.task.count({
        where: {
          profileId,
          status:   { not: 'done' },
          deadline: { gte: now, lte: dueSoonCutoff },
        },
      }),
      prisma.notification.count({
        where: { userId: profileId, readAt: null },
      }),
      prisma.comment.count({
        where: { authorId: profileId, deletedAt: null },
      }),
    ]);

  let total = 0, todo = 0, doing = 0, done = 0;
  for (const g of taskGroups) {
    const c = g._count?._all ?? 0;
    total += c;
    if (g.status === 'todo')  todo  = c;
    if (g.status === 'doing') doing = c;
    if (g.status === 'done')  done  = c;
  }

  return {
    tasks:         { total, todo, doing, done, overdue: overdueCount, dueSoon: dueSoonCount },
    notifications: { unread: unreadCount },
    comments:      { total: commentCount },
  };
}

// ─── Completion stats interfaces ─────────────────────────────

export interface UserCompletionData {
  period: { startDate: string; endDate: string };
  tasks: {
    created:                 number;
    completed:               number;
    completionRate:          number;
    averageCompletionTimeMs: number | null;
  };
}

export interface AdminCompletionData {
  period: { startDate: string; endDate: string };
  tasks: {
    created:                 number;
    completed:               number;
    completionRate:          number;
    averageCompletionTimeMs: number | null;
    byStatus: { todo: number; doing: number; done: number };
  };
}

export async function getUserCompletionStats(
  profileId: string,
  startDate: string,
  endDate:   string,
): Promise<UserCompletionData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  const [createdCount, completedCount] = await prisma.$transaction([
    prisma.task.count({ where: { profileId, createdAt:   { gte: start, lte: end } } }),
    prisma.task.count({ where: { profileId, completedAt: { gte: start, lte: end } } }),
  ]);

  // AVG(completedAt - createdAt) cannot be expressed in Prisma aggregate — use bounded raw query
  const avgRaw = await prisma.$queryRaw<AvgResult[]>`
    SELECT AVG(
      EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000
    ) AS avg_ms
    FROM "tasks"
    WHERE "profileId" = ${profileId}
      AND "completedAt" >= ${start}
      AND "completedAt" <= ${end}
  `;

  const avgRow = avgRaw[0];
  const averageCompletionTimeMs =
    avgRow !== undefined && avgRow.avg_ms !== null
      ? Math.round(Number(avgRow.avg_ms))
      : null;

  const completionRate =
    createdCount > 0
      ? Math.round((completedCount / createdCount) * 10000) / 10000
      : 0;

  return {
    period: { startDate, endDate },
    tasks:  { created: createdCount, completed: completedCount, completionRate, averageCompletionTimeMs },
  };
}

export async function getAdminCompletionStats(
  startDate: string,
  endDate:   string,
): Promise<AdminCompletionData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  const [createdCount, completedCount, statusGroups] = await prisma.$transaction([
    prisma.task.count({ where: { createdAt:   { gte: start, lte: end } } }),
    prisma.task.count({ where: { completedAt: { gte: start, lte: end } } }),
    prisma.task.groupBy({
      by:    ['status'],
      where: { createdAt: { gte: start, lte: end } },
      _count: { _all: true },
    }),
  ]);

  const avgRaw = await prisma.$queryRaw<AvgResult[]>`
    SELECT AVG(
      EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000
    ) AS avg_ms
    FROM "tasks"
    WHERE "completedAt" >= ${start}
      AND "completedAt" <= ${end}
  `;

  const avgRow = avgRaw[0];
  const averageCompletionTimeMs =
    avgRow !== undefined && avgRow.avg_ms !== null
      ? Math.round(Number(avgRow.avg_ms))
      : null;

  const completionRate =
    createdCount > 0
      ? Math.round((completedCount / createdCount) * 10000) / 10000
      : 0;

  let todo = 0, doing = 0, done = 0;
  for (const g of statusGroups) {
    const c = g._count?._all ?? 0;
    if (g.status === 'todo')  todo  = c;
    if (g.status === 'doing') doing = c;
    if (g.status === 'done')  done  = c;
  }

  return {
    period: { startDate, endDate },
    tasks: {
      created:  createdCount,
      completed: completedCount,
      completionRate,
      averageCompletionTimeMs,
      byStatus: { todo, doing, done },
    },
  };
}

// ─── Department analytics interfaces ─────────────────────────

export interface DeptSummaryData {
  tasks:   { total: number; todo: number; doing: number; done: number; overdue: number; dueSoon: number };
  members: { active: number };
}

export interface AdminDeptSummaryData {
  name:    string;
  tasks:   { total: number; todo: number; doing: number; done: number; overdue: number; dueSoon: number };
  members: { active: number };
}

export interface DeptCompletionData {
  period: { startDate: string; endDate: string };
  tasks:  { created: number; completed: number; completionRate: number; averageCompletionTimeMs: number | null };
}

export interface AdminDeptListItem {
  id:      string;
  name:    string;
  tasks:   { total: number };
  members: { active: number };
}

export interface AdminDeptListData {
  page:        number;
  limit:       number;
  total:       number;
  departments: AdminDeptListItem[];
}

// ─── Department analytics helpers ────────────────────────────

export async function checkActiveMembership(
  profileId:    string,
  departmentId: string,
): Promise<{ deptExists: boolean; isActiveMember: boolean }> {
  const [dept, membership] = await prisma.$transaction([
    prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }),
    prisma.departmentMember.findUnique({
      where:  { userId_departmentId: { userId: profileId, departmentId } },
      select: { status: true },
    }),
  ]);
  return {
    deptExists:     dept !== null,
    isActiveMember: membership?.status === 'ACTIVE',
  };
}

// ─── Department analytics functions ──────────────────────────

export async function getDeptSummary(departmentId: string): Promise<DeptSummaryData> {
  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_MS);
  const projectIds = await getProjectIdsByDepartment(departmentId);

  const [taskGroups, overdueCount, dueSoonCount, memberCount] = await prisma.$transaction([
    prisma.task.groupBy({
      by:    ['status'],
      where: { projectId: { in: projectIds } },
      _count: { status: true },
    }),
    prisma.task.count({
      where: { projectId: { in: projectIds }, status: { not: 'done' }, deadline: { lt: now } },
    }),
    prisma.task.count({
      where: { projectId: { in: projectIds }, status: { not: 'done' }, deadline: { gte: now, lte: dueSoonCutoff } },
    }),
    prisma.departmentMember.count({
      where: { departmentId, status: 'ACTIVE' },
    }),
  ]);

  let total = 0, todo = 0, doing = 0, done = 0;
  for (const g of taskGroups) {
    const c = g._count.status;
    total += c;
    if (g.status === 'todo')  todo  = c;
    if (g.status === 'doing') doing = c;
    if (g.status === 'done')  done  = c;
  }

  return {
    tasks:   { total, todo, doing, done, overdue: overdueCount, dueSoon: dueSoonCount },
    members: { active: memberCount },
  };
}

export async function getDeptCompletionStats(
  departmentId: string,
  startDate:    string,
  endDate:      string,
): Promise<DeptCompletionData> {
  const { start, end } = toUTCDateRange(startDate, endDate);
  const projectIds = await getProjectIdsByDepartment(departmentId);

  if (projectIds.length === 0) {
    return {
      period: { startDate, endDate },
      tasks:  { created: 0, completed: 0, completionRate: 0, averageCompletionTimeMs: null },
    };
  }

  const [createdCount, completedCount] = await prisma.$transaction([
    prisma.task.count({ where: { projectId: { in: projectIds }, createdAt:   { gte: start, lte: end } } }),
    prisma.task.count({ where: { projectId: { in: projectIds }, completedAt: { gte: start, lte: end } } }),
  ]);

  const avgRaw = await prisma.$queryRaw<AvgResult[]>(
    Prisma.sql`
      SELECT AVG(
        EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000
      ) AS avg_ms
      FROM "tasks"
      WHERE "projectId" IN (${Prisma.join(projectIds)})
        AND "completedAt" >= ${start}
        AND "completedAt" <= ${end}
    `
  );

  const avgRow = avgRaw[0];
  const averageCompletionTimeMs =
    avgRow !== undefined && avgRow.avg_ms !== null
      ? Math.round(Number(avgRow.avg_ms))
      : null;

  const completionRate =
    createdCount > 0
      ? Math.round((completedCount / createdCount) * 10000) / 10000
      : 0;

  return {
    period: { startDate, endDate },
    tasks:  { created: createdCount, completed: completedCount, completionRate, averageCompletionTimeMs },
  };
}

export async function getAdminDeptList(page: number, limit: number): Promise<AdminDeptListData> {
  const skip = (page - 1) * limit;

  const [total, departments] = await prisma.$transaction([
    prisma.department.count(),
    prisma.department.findMany({
      skip,
      take:    limit,
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    }),
  ]);

  if (departments.length === 0) {
    return { page, limit, total, departments: [] };
  }

  const deptIds = departments.map(d => d.id);

  // Batch-fetch all dept→project links, then build projectId→taskCount map
  const deptProjectMap = await getProjectIdsByDepartments(deptIds);
  const allProjectIds = [...new Set([...deptProjectMap.values()].flat())];

  const projectTaskCountMap = new Map<string, number>();
  if (allProjectIds.length > 0) {
    const taskGroups = await prisma.task.groupBy({
      by:    ['projectId'],
      where: { projectId: { in: allProjectIds } },
      _count: { id: true },
    });
    for (const g of taskGroups) {
      if (g.projectId !== null) projectTaskCountMap.set(g.projectId, g._count.id);
    }
  }

  const memberGroups = await prisma.departmentMember.groupBy({
    by:    ['departmentId'],
    where: { departmentId: { in: deptIds }, status: 'ACTIVE' },
    _count: { id: true },
  });
  const memberMap = new Map<string, number>();
  for (const g of memberGroups) {
    memberMap.set(g.departmentId, g._count.id);
  }

  return {
    page,
    limit,
    total,
    departments: departments.map(d => {
      const projIds = deptProjectMap.get(d.id) ?? [];
      const taskCount = projIds.reduce((sum, pid) => sum + (projectTaskCountMap.get(pid) ?? 0), 0);
      return {
        id:      d.id,
        name:    d.name,
        tasks:   { total: taskCount },
        members: { active: memberMap.get(d.id) ?? 0 },
      };
    }),
  };
}

export async function getAdminDeptSummary(departmentId: string): Promise<AdminDeptSummaryData | null> {
  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_MS);

  const [dept, projectIds] = await Promise.all([
    prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } }),
    getProjectIdsByDepartment(departmentId),
  ]);

  if (dept === null) return null;

  const [taskGroups, overdueCount, dueSoonCount, memberCount] = await prisma.$transaction([
    prisma.task.groupBy({
      by:    ['status'],
      where: { projectId: { in: projectIds } },
      _count: { status: true },
    }),
    prisma.task.count({
      where: { projectId: { in: projectIds }, status: { not: 'done' }, deadline: { lt: now } },
    }),
    prisma.task.count({
      where: { projectId: { in: projectIds }, status: { not: 'done' }, deadline: { gte: now, lte: dueSoonCutoff } },
    }),
    prisma.departmentMember.count({
      where: { departmentId, status: 'ACTIVE' },
    }),
  ]);

  let total = 0, todo = 0, doing = 0, done = 0;
  for (const g of taskGroups) {
    const c = g._count.status;
    total += c;
    if (g.status === 'todo')  todo  = c;
    if (g.status === 'doing') doing = c;
    if (g.status === 'done')  done  = c;
  }

  return {
    name:    dept.name,
    tasks:   { total, todo, doing, done, overdue: overdueCount, dueSoon: dueSoonCount },
    members: { active: memberCount },
  };
}

// ─── Trend analytics interfaces ──────────────────────────────

export interface TrendPoint {
  date:      string;
  created:   number;
  completed: number;
}

export interface TrendsData {
  period: { startDate: string; endDate: string };
  series: TrendPoint[];
}

// ─── Trend analytics helpers ──────────────────────────────────

function buildTrendSeries(
  startDate:     string,
  endDate:       string,
  createdRows:   TrendRow[],
  completedRows: TrendRow[],
): TrendsData {
  const createdMap   = new Map<string, number>();
  const completedMap = new Map<string, number>();

  for (const r of createdRows)   createdMap.set(r.day.toISOString().slice(0, 10),   Number(r.count));
  for (const r of completedRows) completedMap.set(r.day.toISOString().slice(0, 10), Number(r.count));

  const series: TrendPoint[] = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const endDt   = new Date(`${endDate}T00:00:00.000Z`);

  while (current <= endDt) {
    const dateStr = current.toISOString().slice(0, 10);
    series.push({
      date:      dateStr,
      created:   createdMap.get(dateStr)   ?? 0,
      completed: completedMap.get(dateStr) ?? 0,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return { period: { startDate, endDate }, series };
}

// ─── Trend analytics functions ────────────────────────────────

export async function getUserTrends(
  profileId: string,
  startDate: string,
  endDate:   string,
): Promise<TrendsData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  const [createdRows, completedRows] = await Promise.all([
    prisma.$queryRaw<TrendRow[]>`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM "tasks"
      WHERE "profileId" = ${profileId}
        AND "createdAt" >= ${start} AND "createdAt" <= ${end}
      GROUP BY day ORDER BY day
    `,
    prisma.$queryRaw<TrendRow[]>`
      SELECT DATE_TRUNC('day', "completedAt") AS day, COUNT(*)::int AS count
      FROM "tasks"
      WHERE "profileId" = ${profileId}
        AND "completedAt" >= ${start} AND "completedAt" <= ${end}
      GROUP BY day ORDER BY day
    `,
  ]);

  return buildTrendSeries(startDate, endDate, createdRows, completedRows);
}

// ─── Time stats interfaces ────────────────────────────────────

export interface UserTimeStatsData {
  period:  { startDate: string; endDate: string };
  summary: { totalDurationSeconds: number; sessionCount: number; averageSessionSeconds: number | null };
  byTask:  Array<{ taskId: string; title: string; totalDurationSeconds: number; sessionCount: number }>;
}

export interface AdminTimeStatsData {
  period:  { startDate: string; endDate: string };
  summary: { totalDurationSeconds: number; sessionCount: number; averageSessionSeconds: number | null };
}

interface ByTaskRow {
  taskId:        string;
  title:         string;
  total_seconds: number;
  session_count: number;
}

// ─── Time stats functions ─────────────────────────────────────

export async function getUserTimeStats(
  profileId: string,
  startDate: string,
  endDate:   string,
): Promise<UserTimeStatsData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  const [summaryResult, byTaskRows] = await Promise.all([
    prisma.timeTrackingSession.aggregate({
      where:  { profileId, startedAt: { gte: start, lte: end }, stoppedAt: { not: null } },
      _sum:   { durationSeconds: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<ByTaskRow[]>`
      SELECT
        tts."taskId",
        t.title,
        COALESCE(SUM(tts."durationSeconds"), 0)::int AS total_seconds,
        COUNT(*)::int AS session_count
      FROM time_tracking_sessions tts
      JOIN tasks t ON t.id = tts."taskId"
      WHERE tts."profileId" = ${profileId}
        AND tts."startedAt" >= ${start}
        AND tts."startedAt" <= ${end}
        AND tts."stoppedAt" IS NOT NULL
      GROUP BY tts."taskId", t.title
      ORDER BY total_seconds DESC
    `,
  ]);

  const totalDurationSeconds  = summaryResult._sum.durationSeconds  ?? 0;
  const sessionCount          = summaryResult._count._all;
  const averageSessionSeconds = sessionCount > 0
    ? Math.round(totalDurationSeconds / sessionCount)
    : null;

  return {
    period:  { startDate, endDate },
    summary: { totalDurationSeconds, sessionCount, averageSessionSeconds },
    byTask:  byTaskRows.map(r => ({
      taskId:              r.taskId,
      title:               r.title,
      totalDurationSeconds: r.total_seconds,
      sessionCount:         r.session_count,
    })),
  };
}

export async function getAdminTimeStats(
  startDate: string,
  endDate:   string,
): Promise<AdminTimeStatsData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  const summaryResult = await prisma.timeTrackingSession.aggregate({
    where:  { startedAt: { gte: start, lte: end }, stoppedAt: { not: null } },
    _sum:   { durationSeconds: true },
    _count: { _all: true },
  });

  const totalDurationSeconds  = summaryResult._sum.durationSeconds  ?? 0;
  const sessionCount          = summaryResult._count._all;
  const averageSessionSeconds = sessionCount > 0
    ? Math.round(totalDurationSeconds / sessionCount)
    : null;

  return {
    period:  { startDate, endDate },
    summary: { totalDurationSeconds, sessionCount, averageSessionSeconds },
  };
}

// ─── Heatmap interfaces ───────────────────────────────────────

interface HeatmapRow {
  day_of_week: number;
  hour:        number;
  count:       number;
}

export interface HeatmapBucket {
  dayOfWeek:  number;
  hour:       number;
  created:    number;
  completed:  number;
  /** Derived field: total = created + completed */
  total:      number;
}

export interface HeatmapSummary {
  peakDayOfWeek:  number | null;
  peakHour:       number | null;
  totalCreated:   number;
  totalCompleted: number;
}

export interface UserHeatmapData {
  period:  { startDate: string; endDate: string };
  heatmap: readonly HeatmapBucket[];
  summary: HeatmapSummary;
}

export interface AdminHeatmapData {
  period:  { startDate: string; endDate: string };
  heatmap: readonly HeatmapBucket[];
  summary: HeatmapSummary;
}

// ─── Heatmap helpers ──────────────────────────────────────────

// Zero-fill is the source of truth for ordering and length.
// Iterates dayOfWeek 0..6, hour 0..23 → always exactly 168 entries, stable order.
// DB sparse results populate counts only — never determine array order.
// Heatmap buckets are computed in UTC, not user-local timezone.
function buildHeatmap(
  createdRows:   HeatmapRow[],
  completedRows: HeatmapRow[],
): readonly HeatmapBucket[] {
  const createdMap   = new Map<string, number>();
  const completedMap = new Map<string, number>();

  for (const r of createdRows)   createdMap.set(`${r.day_of_week}:${r.hour}`,   r.count);
  for (const r of completedRows) completedMap.set(`${r.day_of_week}:${r.hour}`, r.count);

  const heatmap: HeatmapBucket[] = [];
  for (let d = 0; d <= 6; d++) {
    for (let h = 0; h <= 23; h++) {
      const key       = `${d}:${h}`;
      const created   = createdMap.get(key)   ?? 0;
      const completed = completedMap.get(key) ?? 0;
      heatmap.push(Object.freeze({
        dayOfWeek: d,
        hour:      h,
        created,
        completed,
        total: created + completed,
      }));
    }
  }
  return Object.freeze(heatmap);
}

// Peak bucket = highest total (created + completed).
// Tie-break: first occurrence wins per iteration order (dayOfWeek ASC → hour ASC).
// If entire heatmap is zero, peak fields are null — never defaulted to 0:00.
function calculateSummary(heatmap: readonly HeatmapBucket[]): HeatmapSummary {
  let totalCreated   = 0;
  let totalCompleted = 0;
  let peakTotal      = 0;
  let peakDayOfWeek: number | null = null;
  let peakHour:      number | null = null;

  for (const b of heatmap) {
    totalCreated   += b.created;
    totalCompleted += b.completed;
    // Strict > preserves tie-break: first-seen (lowest dayOfWeek then hour) wins
    if (b.total > peakTotal) {
      peakTotal     = b.total;
      peakDayOfWeek = b.dayOfWeek;
      peakHour      = b.hour;
    }
  }

  return { peakDayOfWeek, peakHour, totalCreated, totalCompleted };
}

// ─── Heatmap functions ────────────────────────────────────────

export async function getUserHeatmap(
  profileId: string,
  startDate: string,
  endDate:   string,
): Promise<UserHeatmapData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  // Heatmap buckets are computed in UTC, not user-local timezone
  const [createdRows, completedRows] = await Promise.all([
    prisma.$queryRaw<HeatmapRow[]>`
      SELECT EXTRACT(DOW  FROM "createdAt")::int AS day_of_week,
             EXTRACT(HOUR FROM "createdAt")::int AS hour,
             COUNT(*)::int                        AS count
      FROM "tasks"
      WHERE "profileId" = ${profileId}
        AND "createdAt" >= ${start}
        AND "createdAt" <= ${end}
      GROUP BY day_of_week, hour
    `,
    prisma.$queryRaw<HeatmapRow[]>`
      SELECT EXTRACT(DOW  FROM "completedAt")::int AS day_of_week,
             EXTRACT(HOUR FROM "completedAt")::int AS hour,
             COUNT(*)::int                          AS count
      FROM "tasks"
      WHERE "profileId" = ${profileId}
        AND "completedAt" IS NOT NULL
        AND "completedAt" >= ${start}
        AND "completedAt" <= ${end}
      GROUP BY day_of_week, hour
    `,
  ]);

  const heatmap = buildHeatmap(createdRows, completedRows);
  return { period: { startDate, endDate }, heatmap, summary: calculateSummary(heatmap) };
}

export async function getAdminHeatmap(
  startDate: string,
  endDate:   string,
): Promise<AdminHeatmapData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  // Heatmap buckets are computed in UTC, not user-local timezone
  const [createdRows, completedRows] = await Promise.all([
    prisma.$queryRaw<HeatmapRow[]>`
      SELECT EXTRACT(DOW  FROM "createdAt")::int AS day_of_week,
             EXTRACT(HOUR FROM "createdAt")::int AS hour,
             COUNT(*)::int                        AS count
      FROM "tasks"
      WHERE "createdAt" >= ${start}
        AND "createdAt" <= ${end}
      GROUP BY day_of_week, hour
    `,
    prisma.$queryRaw<HeatmapRow[]>`
      SELECT EXTRACT(DOW  FROM "completedAt")::int AS day_of_week,
             EXTRACT(HOUR FROM "completedAt")::int AS hour,
             COUNT(*)::int                          AS count
      FROM "tasks"
      WHERE "completedAt" IS NOT NULL
        AND "completedAt" >= ${start}
        AND "completedAt" <= ${end}
      GROUP BY day_of_week, hour
    `,
  ]);

  const heatmap = buildHeatmap(createdRows, completedRows);
  return { period: { startDate, endDate }, heatmap, summary: calculateSummary(heatmap) };
}

export async function getAdminTrends(
  startDate: string,
  endDate:   string,
): Promise<TrendsData> {
  const { start, end } = toUTCDateRange(startDate, endDate);

  const [createdRows, completedRows] = await Promise.all([
    prisma.$queryRaw<TrendRow[]>`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM "tasks"
      WHERE "createdAt" >= ${start} AND "createdAt" <= ${end}
      GROUP BY day ORDER BY day
    `,
    prisma.$queryRaw<TrendRow[]>`
      SELECT DATE_TRUNC('day', "completedAt") AS day, COUNT(*)::int AS count
      FROM "tasks"
      WHERE "completedAt" >= ${start} AND "completedAt" <= ${end}
      GROUP BY day ORDER BY day
    `,
  ]);

  return buildTrendSeries(startDate, endDate, createdRows, completedRows);
}

export async function getAdminSummary(): Promise<AdminSummaryData> {
  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_MS);
  const todayUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));

  const [
    userGroups,
    taskGroups,
    overdueCount,
    dueSoonCount,
    createdTodayCount,
    deptCount,
    commentCount,
  ] = await prisma.$transaction([
    prisma.profile.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.task.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.task.count({
      where: { status: { not: 'done' }, deadline: { lt: now } },
    }),
    prisma.task.count({
      where: { status: { not: 'done' }, deadline: { gte: now, lte: dueSoonCutoff } },
    }),
    prisma.task.count({
      where: { createdAt: { gte: todayUTC } },
    }),
    prisma.department.count(),
    prisma.comment.count({ where: { deletedAt: null } }),
  ]);

  let userTotal = 0, active = 0, banned = 0;
  for (const g of userGroups) {
    const c = g._count.status;
    userTotal += c;
    if (g.status === 'ACTIVE') active = c;
    if (g.status === 'BANNED') banned = c;
  }

  let taskTotal = 0, todo = 0, doing = 0, done = 0;
  for (const g of taskGroups) {
    const c = g._count.status;
    taskTotal += c;
    if (g.status === 'todo')  todo  = c;
    if (g.status === 'doing') doing = c;
    if (g.status === 'done')  done  = c;
  }

  return {
    users:       { total: userTotal, active, banned },
    tasks:       { total: taskTotal, todo, doing, done, overdue: overdueCount, dueSoon: dueSoonCount, createdToday: createdTodayCount },
    departments: { total: deptCount },
    comments:    { total: commentCount },
  };
}
