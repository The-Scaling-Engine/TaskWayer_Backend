import { Router } from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../config/prisma';
import { sendSuccess, sendError, codeFor } from '../utils/apiResponse';
import {
  buildEnrichedDailyDigestBlocks,
  buildEnrichedWeeklyDigestBlocks,
  getWeekBoundsInTimezone,
  sendSlackMessage,
} from '../services/slackService';
import { ServiceError } from '../services/departmentService';
import logger from '../config/logger';

// mergeParams: true — inherits :id (projectId) from projectRoutes parent
const router = Router({ mergeParams: true });

async function assertManager(projectId: string, profileId: string): Promise<void> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, profileId, role: { in: ['OWNER', 'MANAGER'] } },
  });
  if (!member) throw new ServiceError('Only project OWNER or MANAGER can manage Slack config', 403);
}

function assertHttpsUrl(url: string, field: string): void {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error();
    if (!u.hostname.includes('.')) throw new Error();
  } catch {
    throw new ServiceError(`${field} must be a valid https:// URL (e.g. https://hooks.slack.com/...)`, 400);
  }
}

// GET /api/projects/:id/slack-config
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    await assertManager(projectId, req.user!.prismaId);
    const config = await prisma.projectSlackConfig.findUnique({ where: { projectId } });
    sendSuccess(res, 200, { data: config ?? null });
  } catch (err) {
    if (err instanceof ServiceError) { sendError(res, req, err.statusCode, codeFor(err.statusCode), err.message); return; }
    logger.error({ err }, 'getSlackConfig failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// PUT /api/projects/:id/slack-config
router.put('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    await assertManager(projectId, req.user!.prismaId);

    const {
      webhookUrl,
      dailyEnabled,
      weeklyEnabled,
      managerWebhookUrl,
      memberWebhookUrl,
      timezone,
      dailyTime,
      weeklyDay,
      weeklyTime,
    } = req.body as {
      webhookUrl: string;
      dailyEnabled?: boolean;
      weeklyEnabled?: boolean;
      managerWebhookUrl?: string | null;
      memberWebhookUrl?: string | null;
      timezone?: string;
      dailyTime?: string;
      weeklyDay?: number;
      weeklyTime?: string;
    };

    if (!webhookUrl?.trim()) throw new ServiceError('webhookUrl is required', 400);
    assertHttpsUrl(webhookUrl.trim(), 'webhookUrl');
    if (managerWebhookUrl) assertHttpsUrl(managerWebhookUrl.trim(), 'managerWebhookUrl');
    if (memberWebhookUrl) assertHttpsUrl(memberWebhookUrl.trim(), 'memberWebhookUrl');
    if (timezone !== undefined) {
      try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
      catch { throw new ServiceError('Invalid timezone', 400); }
    }
    if (dailyTime !== undefined && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(dailyTime)) {
      throw new ServiceError('dailyTime must be HH:MM (00:00–23:59)', 400);
    }
    if (weeklyTime !== undefined && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(weeklyTime)) {
      throw new ServiceError('weeklyTime must be HH:MM (00:00–23:59)', 400);
    }
    if (weeklyDay !== undefined && (!Number.isInteger(weeklyDay) || weeklyDay < 0 || weeklyDay > 6)) {
      throw new ServiceError('weeklyDay must be an integer 0–6 (0=Sun, 5=Fri)', 400);
    }

    const config = await prisma.projectSlackConfig.upsert({
      where: { projectId },
      update: {
        webhookUrl: webhookUrl.trim(),
        ...(dailyEnabled !== undefined && { dailyEnabled }),
        ...(weeklyEnabled !== undefined && { weeklyEnabled }),
        ...(managerWebhookUrl !== undefined && { managerWebhookUrl: managerWebhookUrl || null }),
        ...(memberWebhookUrl !== undefined && { memberWebhookUrl: memberWebhookUrl || null }),
        ...(timezone !== undefined && { timezone }),
        ...(dailyTime !== undefined && { dailyTime }),
        ...(weeklyDay !== undefined && { weeklyDay }),
        ...(weeklyTime !== undefined && { weeklyTime }),
      },
      create: {
        projectId,
        webhookUrl: webhookUrl.trim(),
        dailyEnabled: dailyEnabled ?? true,
        weeklyEnabled: weeklyEnabled ?? true,
        managerWebhookUrl: managerWebhookUrl || null,
        memberWebhookUrl: memberWebhookUrl || null,
        ...(timezone !== undefined && { timezone }),
        ...(dailyTime !== undefined && { dailyTime }),
        ...(weeklyDay !== undefined && { weeklyDay }),
        ...(weeklyTime !== undefined && { weeklyTime }),
      },
    });

    sendSuccess(res, 200, { message: 'Slack config saved', data: config });
  } catch (err) {
    if (err instanceof ServiceError) { sendError(res, req, err.statusCode, codeFor(err.statusCode), err.message); return; }
    logger.error({ err }, 'saveSlackConfig failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// DELETE /api/projects/:id/slack-config
router.delete('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    await assertManager(projectId, req.user!.prismaId);
    await prisma.projectSlackConfig.delete({ where: { projectId } }).catch(() => {});
    sendSuccess(res, 200, { message: 'Slack config removed' });
  } catch (err) {
    if (err instanceof ServiceError) { sendError(res, req, err.statusCode, codeFor(err.statusCode), err.message); return; }
    logger.error({ err }, 'deleteSlackConfig failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// POST /api/projects/:id/slack-config/test
router.post('/test', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    await assertManager(projectId, req.user!.prismaId);

    const config = await prisma.projectSlackConfig.findUnique({ where: { projectId } });
    if (!config) throw new ServiceError('No Slack config found — save a config first', 404);

    const { type = 'daily' } = req.body as { type?: 'daily' | 'weekly' };
    const now = new Date();
    const tz = config.timezone;

    let blocks;
    if (type === 'weekly') {
      const { start: weekStart, end: weekEnd } = getWeekBoundsInTimezone(now, tz);
      blocks = await buildEnrichedWeeklyDigestBlocks(projectId, weekStart, weekEnd, tz);
    } else {
      blocks = await buildEnrichedDailyDigestBlocks(projectId, now, tz);
    }

    await sendSlackMessage(config.webhookUrl, blocks);

    sendSuccess(res, 200, { message: `Test ${type} digest sent to Slack` });
  } catch (err) {
    if (err instanceof ServiceError) { sendError(res, req, err.statusCode, codeFor(err.statusCode), err.message); return; }
    logger.error({ err }, 'testSlackConfig failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export default router;
