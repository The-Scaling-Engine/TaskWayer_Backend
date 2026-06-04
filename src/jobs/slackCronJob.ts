import cron from 'node-cron';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  buildEnrichedDailyDigestBlocks,
  buildEnrichedWeeklyDigestBlocks,
  getDayBoundsInTimezone,
  getWeekBoundsInTimezone,
  sendSlackMessage,
} from '../services/slackService';

function getLocalDateKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(date);
}

function getLocalWeekKey(date: Date, tz: string): string {
  const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(date);
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const localDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = localDate.getUTCDay(); // 0=Sun
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const thursday = new Date(localDate.getTime() + (3 - daysFromMon) * 86_400_000);
  const thuYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(thuYear, 0, 4, 12, 0, 0));
  const jan4DaysFromMon = jan4.getUTCDay() === 0 ? 6 : jan4.getUTCDay() - 1;
  const week1Mon = new Date(jan4.getTime() - jan4DaysFromMon * 86_400_000);
  const wn = Math.floor((thursday.getTime() - week1Mon.getTime()) / (7 * 86_400_000)) + 1;
  return `${thuYear}-W${String(wn).padStart(2, '0')}`;
}

function getLocalDayOfWeek(date: Date, tz: string): number {
  const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(date);
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function isWithinWindow(timeStr: string, now: Date, tz: string, toleranceMs = 60_000): boolean {
  const [hh, mm] = timeStr.split(':').map(Number) as [number, number];
  const { start: dayStart } = getDayBoundsInTimezone(now, tz);
  const targetMs = dayStart.getTime() + (hh * 3_600 + mm * 60) * 1_000;
  return Math.abs(now.getTime() - targetMs) < toleranceMs;
}

async function runSlackCronTick(): Promise<void> {
  const now = new Date();

  const configs = await prisma.projectSlackConfig.findMany({
    where: { OR: [{ dailyEnabled: true }, { weeklyEnabled: true }] },
    select: {
      id: true,
      projectId: true,
      webhookUrl: true,
      managerWebhookUrl: true,
      timezone: true,
      dailyEnabled: true,
      dailyTime: true,
      lastDailySentKey: true,
      weeklyEnabled: true,
      weeklyDay: true,
      weeklyTime: true,
      lastWeeklySentKey: true,
    },
  });

  if (configs.length === 0) return;

  await Promise.allSettled(
    configs.map(async (cfg) => {
      const tz = cfg.timezone;

      if (cfg.dailyEnabled && isWithinWindow(cfg.dailyTime, now, tz)) {
        const dailyKey = getLocalDateKey(now, tz);
        const claimed = await prisma.projectSlackConfig.updateMany({
          where: {
            id: cfg.id,
            OR: [{ lastDailySentKey: null }, { lastDailySentKey: { not: dailyKey } }],
          },
          data: { lastDailySentKey: dailyKey },
        });
        if (claimed.count > 0) {
          try {
            const blocks = await buildEnrichedDailyDigestBlocks(cfg.projectId, now, tz);
            if (blocks.length > 0) {
              await sendSlackMessage(cfg.webhookUrl, blocks);
              if (cfg.managerWebhookUrl) await sendSlackMessage(cfg.managerWebhookUrl, blocks);
              logger.info({ projectId: cfg.projectId, key: dailyKey }, 'slack-cron: daily sent');
            }
          } catch (err) {
            logger.error({ err, projectId: cfg.projectId }, 'slack-cron: daily send failed');
          }
        }
      }

      if (
        cfg.weeklyEnabled &&
        getLocalDayOfWeek(now, tz) === cfg.weeklyDay &&
        isWithinWindow(cfg.weeklyTime, now, tz)
      ) {
        const weeklyKey = getLocalWeekKey(now, tz);
        const claimed = await prisma.projectSlackConfig.updateMany({
          where: {
            id: cfg.id,
            OR: [{ lastWeeklySentKey: null }, { lastWeeklySentKey: { not: weeklyKey } }],
          },
          data: { lastWeeklySentKey: weeklyKey },
        });
        if (claimed.count > 0) {
          try {
            const { start: weekStart, end: weekEnd } = getWeekBoundsInTimezone(now, tz);
            const blocks = await buildEnrichedWeeklyDigestBlocks(cfg.projectId, weekStart, weekEnd, tz);
            if (blocks.length > 0) {
              await sendSlackMessage(cfg.webhookUrl, blocks);
              if (cfg.managerWebhookUrl) await sendSlackMessage(cfg.managerWebhookUrl, blocks);
              logger.info({ projectId: cfg.projectId, key: weeklyKey }, 'slack-cron: weekly sent');
            }
          } catch (err) {
            logger.error({ err, projectId: cfg.projectId }, 'slack-cron: weekly send failed');
          }
        }
      }
    }),
  );
}

export function startSlackCronJob(): void {
  cron.schedule('* * * * *', () => {
    void runSlackCronTick();
  });
  logger.info('slack-cron-job: scheduled (every minute, per-project timezone + idempotency)');
}

export { runSlackCronTick };
