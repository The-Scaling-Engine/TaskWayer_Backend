import cron from 'node-cron';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { buildDailyDigestBlocks, sendSlackMessage } from '../services/slackService';

async function runDailyDigestJob(): Promise<void> {
  const configs = await prisma.projectSlackConfig.findMany({
    where: { dailyEnabled: true },
    select: { projectId: true, webhookUrl: true, managerWebhookUrl: true },
  });

  if (configs.length === 0) return;

  const today = new Date();
  logger.info({ count: configs.length }, 'daily-digest-job: processing projects');

  await Promise.allSettled(
    configs.map(async (cfg) => {
      try {
        const blocks = await buildDailyDigestBlocks(cfg.projectId, today);
        if (blocks.length === 0) return;

        await sendSlackMessage(cfg.webhookUrl, blocks);

        if (cfg.managerWebhookUrl) {
          await sendSlackMessage(cfg.managerWebhookUrl, blocks);
        }

        logger.info({ projectId: cfg.projectId }, 'daily-digest-job: sent');
      } catch (err) {
        logger.error({ err, projectId: cfg.projectId }, 'daily-digest-job: failed for project');
      }
    })
  );
}

export function startDailyDigestJob(): void {
  // 11:00 UTC = 18:00 UTC+7
  cron.schedule('0 11 * * *', () => {
    void runDailyDigestJob();
  });
  logger.info('daily-digest-job: scheduled (11:00 UTC / 18:00 VN)');
}

export { runDailyDigestJob };
