import prisma from '../config/prisma';
import logger from '../config/logger';

type SlackBlock = Record<string, unknown>;

// ─── HTTP send ────────────────────────────────────────────────

export async function sendSlackMessage(webhookUrl: string, blocks: SlackBlock[]): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(d: Date, tz = 'Asia/Ho_Chi_Minh'): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz });
}

function taskLine(title: string, suffix = ''): string {
  return `• ${title}${suffix}`;
}

function daysAgo(deadline: Date, now: Date): string {
  const days = Math.floor((now.getTime() - deadline.getTime()) / 86_400_000);
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}

// ─── Timezone helpers ─────────────────────────────────────────

function localMidnightToUTC(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe);
  const localDay = Number(parts.find(p => p.type === 'day')!.value);
  const hh       = Number(parts.find(p => p.type === 'hour')!.value);
  const mn       = Number(parts.find(p => p.type === 'minute')!.value);
  const ss       = Number(parts.find(p => p.type === 'second')!.value);
  const elapsed  = (hh * 3_600 + mn * 60 + ss) * 1_000;
  return localDay === d
    ? new Date(probe.getTime() - elapsed)
    : new Date(probe.getTime() + 86_400_000 - elapsed);
}

export function getDayBoundsInTimezone(utcNow: Date, tz: string): { start: Date; end: Date } {
  const dateStr   = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(utcNow);
  const start     = localMidnightToUTC(dateStr, tz);
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const nextProbe = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const nextStr   = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(nextProbe);
  const end       = new Date(localMidnightToUTC(nextStr, tz).getTime() - 1);
  return { start, end };
}

export function getWeekBoundsInTimezone(utcNow: Date, tz: string): { start: Date; end: Date } {
  const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(utcNow);
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const sixDaysAgo = new Date(Date.UTC(y, m - 1, d - 6, 12, 0, 0));
  const sixDaysAgoStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(sixDaysAgo);
  const start = localMidnightToUTC(sixDaysAgoStr, tz);
  const { end } = getDayBoundsInTimezone(utcNow, tz);
  return { start, end };
}

// ─── Done-column helper ───────────────────────────────────────
// Tasks dragged to a "Done" column have columnId updated but status/completedAt
// may not be set if the move was a pure board drag. We detect done columns by
// name (case-insensitive) so the digest excludes them from active sections.

async function getDoneColumnIds(projectId: string): Promise<string[]> {
  const cols = await prisma.boardColumn.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });
  return cols.filter(c => /done/i.test(c.name)).map(c => c.id);
}

// ─── Enriched Daily Digest ────────────────────────────────────

export async function buildEnrichedDailyDigestBlocks(
  projectId: string,
  date: Date,
  timezone: string,
): Promise<SlackBlock[]> {
  const { start, end } = getDayBoundsInTimezone(date, timezone);

  const doneColumnIds = await getDoneColumnIds(projectId);
  const notInDone = doneColumnIds.length > 0
    ? { columnId: { notIn: doneColumnIds } }
    : {};

  const [project, completedToday, overdue, updatedToday] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    }),
    // Completed = explicit completedAt OR dragged to a done column today
    prisma.task.findMany({
      where: {
        projectId,
        OR: [
          { completedAt: { gte: start, lte: end } },
          ...(doneColumnIds.length > 0 ? [{
            columnId: { in: doneColumnIds },
            updatedAt: { gte: start, lte: end },
          }] : []),
        ],
      },
      select: { title: true, assignedTo: true },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    }),
    prisma.task.findMany({
      where: {
        projectId,
        deadline: { lt: date },
        status: { not: 'done' },
        ...notInDone,
      },
      select: { title: true, deadline: true, priority: true, assignedTo: true },
      orderBy: { deadline: 'asc' },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        projectId,
        updatedAt: { gte: start, lte: end },
        completedAt: null,
        status: { not: 'done' },
        ...notInDone,
      },
      select: { title: true, status: true, assignedTo: true, inProgressAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ]);

  if (!project) return [];

  const assigneeIds = new Set(
    [...completedToday, ...overdue, ...updatedToday]
      .map(t => t.assignedTo)
      .filter((id): id is string => id != null),
  );

  const profiles = assigneeIds.size > 0
    ? await prisma.profile.findMany({
        where: { id: { in: [...assigneeIds] } },
        select: { id: true, name: true },
      })
    : [];

  const nameMap = new Map(profiles.map(p => [p.id, p.name ?? 'Unknown']));
  const by = (id: string | null | undefined) =>
    id && nameMap.has(id) ? `by ${nameMap.get(id)}` : 'unassigned';

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Daily Update — ${project.name} — ${formatDate(date, timezone)}`, emoji: true },
    },
    { type: 'divider' },
  ];

  if (completedToday.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*✅ Completed Today (${completedToday.length})*\n${
          completedToday.map(t => taskLine(t.title, `   ${by(t.assignedTo)}`)).join('\n')
        }`,
      },
    });
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*✅ Completed Today*\n_None_' } });
  }

  blocks.push({ type: 'divider' });

  if (updatedToday.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🔄 Updated Today (${updatedToday.length})*\n${
          updatedToday.map(t => {
            const dur = t.inProgressAt
              ? ` • ${Math.max(1, Math.floor((date.getTime() - t.inProgressAt.getTime()) / 86_400_000))}d`
              : '';
            return taskLine(t.title, `   [${t.status}]${dur} • ${by(t.assignedTo)}`);
          }).join('\n')
        }`,
      },
    });
    blocks.push({ type: 'divider' });
  }

  if (overdue.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⚠️ Overdue (${overdue.length})*\n${
          overdue.map(t => {
            const age      = t.deadline ? ` — ${daysAgo(t.deadline, date)}` : '';
            const priority = ` • ${t.priority.toUpperCase()}`;
            const assignee = ` • ${by(t.assignedTo)}`;
            return taskLine(t.title, `${age}${priority}${assignee}`);
          }).join('\n')
        }`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Generated by Wayer Tasks · ${formatDate(date, timezone)}` }],
  });

  return blocks;
}

// ─── Enriched Weekly Digest ───────────────────────────────────

export async function buildEnrichedWeeklyDigestBlocks(
  projectId: string,
  weekStart: Date,
  weekEnd: Date,
  timezone: string,
): Promise<SlackBlock[]> {
  const doneColumnIds = await getDoneColumnIds(projectId);
  const notInDone = doneColumnIds.length > 0
    ? { columnId: { notIn: doneColumnIds } }
    : {};

  const [project, completedWeek, overdue, created] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    prisma.task.findMany({
      where: {
        projectId,
        OR: [
          { completedAt: { gte: weekStart, lte: weekEnd } },
          ...(doneColumnIds.length > 0 ? [{
            columnId: { in: doneColumnIds },
            updatedAt: { gte: weekStart, lte: weekEnd },
          }] : []),
        ],
      },
      select: { title: true, assignedTo: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        projectId,
        deadline: { lt: weekEnd },
        status: { not: 'done' },
        ...notInDone,
      },
      select: { title: true, deadline: true, priority: true, assignedTo: true },
      orderBy: { deadline: 'asc' },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        projectId,
        createdAt: { gte: weekStart, lte: weekEnd },
        ...notInDone,
      },
      select: { title: true, status: true, assignedTo: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);

  if (!project) return [];

  const assigneeIds = new Set(
    [...completedWeek, ...overdue, ...created]
      .map(t => t.assignedTo)
      .filter((id): id is string => id != null),
  );

  const profiles = assigneeIds.size > 0
    ? await prisma.profile.findMany({
        where: { id: { in: [...assigneeIds] } },
        select: { id: true, name: true },
      })
    : [];

  const nameMap = new Map(profiles.map(p => [p.id, p.name ?? 'Unknown']));
  const by = (id: string | null | undefined) =>
    id && nameMap.has(id) ? `by ${nameMap.get(id)}` : 'unassigned';

  const period = `${formatDate(weekStart, timezone)} – ${formatDate(weekEnd, timezone)}`;

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: `📊 Weekly Summary — ${project.name}`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Period:* ${period}` } },
    { type: 'divider' },
  ];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: completedWeek.length > 0
        ? `*✅ Completed This Week (${completedWeek.length})*\n${completedWeek.map(t => taskLine(t.title, `   ${by(t.assignedTo)}`)).join('\n')}`
        : '*✅ Completed This Week*\n_None_',
    },
  });

  blocks.push({ type: 'divider' });

  if (created.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🆕 New Tasks This Week (${created.length})*\n${created.map(t => taskLine(t.title, `   [${t.status}] • ${by(t.assignedTo)}`)).join('\n')}`,
      },
    });
    blocks.push({ type: 'divider' });
  }

  if (overdue.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⚠️ Overdue (${overdue.length})*\n${
          overdue.map(t => {
            const age      = t.deadline ? ` — ${daysAgo(t.deadline, weekEnd)}` : '';
            const priority = ` • ${t.priority.toUpperCase()}`;
            const assignee = ` • ${by(t.assignedTo)}`;
            return taskLine(t.title, `${age}${priority}${assignee}`);
          }).join('\n')
        }`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Generated by Wayer Tasks · Weekly report` }],
  });

  return blocks;
}
