import cron from 'node-cron';
import { NotificationType, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { env } from '../config/env';
import * as realtimeService from '../services/realtimeService';
import sendEmail from '../utils/email';
import logger from '../config/logger';

// ─── Window definitions ───────────────────────────────────────────────────────

const WINDOWS = [
  { type: NotificationType.DEADLINE_3_DAYS,  ms: 3 * 24 * 60 * 60 * 1000, label: '3 days'   },
  { type: NotificationType.DEADLINE_2_DAYS,  ms: 2 * 24 * 60 * 60 * 1000, label: '2 days'   },
  { type: NotificationType.DEADLINE_1_DAY,   ms: 1 * 24 * 60 * 60 * 1000, label: '1 day'    },
  { type: NotificationType.DEADLINE_12_HOURS, ms: 12 * 60 * 60 * 1000,    label: '12 hours'  },
  { type: NotificationType.DEADLINE_4_HOURS,  ms: 4  * 60 * 60 * 1000,    label: '4 hours'   },
  { type: NotificationType.DEADLINE_1_HOUR,   ms: 1  * 60 * 60 * 1000,    label: '1 hour'    },
] as const;

// ─── Per-window processor ─────────────────────────────────────────────────────

async function processWindow(
  type: NotificationType,
  ms: number,
  label: string
): Promise<void> {
  const now       = new Date();
  const windowEnd = new Date(now.getTime() + ms);

  const tasks = await prisma.task.findMany({
    where: {
      status:   { not: 'done' },
      deadline: { gte: now, lte: windowEnd },
    },
    include: {
      profile: { select: { email: true, name: true } },
    },
  });

  for (const task of tasks) {
    if (!task.profile) continue;

    // Dedup: skip if this window's notification was already sent for this task+user
    const existing = await prisma.notification.findFirst({
      where: { userId: task.profileId, type, entityId: task.id },
    });
    if (existing) continue;

    const title   = `Task deadline in ${label}`;
    const message = `Your task "${task.title}" is due in ${label}. Created: ${task.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    const payload = { taskId: task.id, deadline: task.deadline?.toISOString(), createdAt: task.createdAt.toISOString() };

    // Create system notification record
    const notification = await prisma.notification.create({
      data: {
        userId:     task.profileId,
        type,
        title,
        message,
        entityType: 'task',
        entityId:   task.id,
        payload:    payload as Prisma.InputJsonValue,
      },
    });

    // Emit real-time via Socket.IO to user room
    realtimeService.emitNotification(task.profileId, {
      id:         notification.id,
      type:       notification.type,
      title:      notification.title,
      message:    notification.message,
      payload:    notification.payload,
      entityType: notification.entityType,
      entityId:   notification.entityId,
      createdAt:  notification.createdAt,
    });

    // Send email — fire-and-forget so one failure doesn't block the rest
    sendEmail({
      email:   task.profile.email,
      subject: `Deadline reminder: ${task.title}`,
      message,
      html: buildDeadlineEmailHtml(task.title, task.profile.name, label, task.deadline, task.createdAt),
    }).catch(err =>
      logger.error({ err, taskId: task.id }, 'deadline notification email failed')
    );
  }
}

// ─── Email template ───────────────────────────────────────────────────────────

function buildDeadlineEmailHtml(
  taskTitle: string,
  userName: string | null,
  label: string,
  deadline: Date | null,
  createdAt: Date
): string {
  const deadlineStr = deadline
    ? deadline.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'N/A';

  const createdAtStr = createdAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  const safe = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const greeting = userName ? `Hi ${safe(userName)},` : 'Hi,';
  const ctaUrl   = `${env.CLIENT_URL}/tasks`;

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="color:#e53e3e;">Task Deadline Reminder</h2>
      <p>${greeting}</p>
      <p>Your task <strong>"${safe(taskTitle)}"</strong> is due in <strong>${safe(label)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr>
          <td style="padding:8px;background:#f7fafc;font-weight:bold;width:120px;">Deadline</td>
          <td style="padding:8px;">${safe(deadlineStr)}</td>
        </tr>
        <tr>
          <td style="padding:8px;background:#f7fafc;font-weight:bold;">Time left</td>
          <td style="padding:8px;">${safe(label)}</td>
        </tr>
        <tr>
          <td style="padding:8px;background:#f7fafc;font-weight:bold;">Created</td>
          <td style="padding:8px;">${safe(createdAtStr)}</td>
        </tr>
      </table>
      <div style="margin-top:24px;">
        <a href="${ctaUrl}"
           style="background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
          View task
        </a>
      </div>
      <p style="margin-top:24px;color:#718096;font-size:13px;">
        You are receiving this because you have an upcoming task deadline on Wayer Ops.
      </p>
    </div>
  `;
}

// ─── Job runner ───────────────────────────────────────────────────────────────

async function runDeadlineNotificationJob(): Promise<void> {
  logger.info('deadline-notification-job: tick');
  try {
    for (const w of WINDOWS) {
      await processWindow(w.type, w.ms, w.label);
    }
  } catch (err) {
    logger.error({ err }, 'deadline-notification-job: unexpected error');
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startDeadlineNotificationJob(): void {
  cron.schedule('*/10 * * * *', () => {
    void runDeadlineNotificationJob();
  });
  logger.info('deadline-notification-job: scheduled (every 10 min)');
}
