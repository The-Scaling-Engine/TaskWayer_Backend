import cron from 'node-cron';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { buildWeeklyDigestBlocks, sendSlackMessage } from '../services/slackService';

async function runWeeklyDigestJob(): Promise<void> {
  const configs = await prisma.projectSlackConfig.findMany({
    where: { weeklyEnabled: true },
    select: { projectId: true, webhookUrl: true, managerWebhookUrl: true },
  });

  if (configs.length === 0) return;

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  logger.info({ count: configs.length }, 'weekly-digest-job: processing projects');

  await Promise.allSettled(
    configs.map(async (cfg) => {
      try {
        const blocks = await buildWeeklyDigestBlocks(cfg.projectId, weekStart, weekEnd);
        if (blocks.length === 0) return;

        await sendSlackMessage(cfg.webhookUrl, blocks);

        if (cfg.managerWebhookUrl) {
          await sendSlackMessage(cfg.managerWebhookUrl, blocks);
        }

        logger.info({ projectId: cfg.projectId }, 'weekly-digest-job: sent');
      } catch (err) {
        logger.error({ err, projectId: cfg.projectId }, 'weekly-digest-job: failed for project');
      }
    })
  );
}

export function startWeeklyDigestJob(): void {
  // 10:00 UTC Friday = 17:00 UTC+7 Friday
  cron.schedule('0 10 * * 5', () => {
    void runWeeklyDigestJob();
  });
  logger.info('weekly-digest-job: scheduled (10:00 UTC Friday / 17:00 VN Friday)');
}

export { runWeeklyDigestJob };
