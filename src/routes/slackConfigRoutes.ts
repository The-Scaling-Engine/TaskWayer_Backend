import { Router } from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../config/prisma';
import { sendSuccess, sendError, codeFor } from '../utils/apiResponse';
import { buildDailyDigestBlocks, sendSlackMessage } from '../services/slackService';
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
    } = req.body as {
      webhookUrl: string;
      dailyEnabled?: boolean;
      weeklyEnabled?: boolean;
      managerWebhookUrl?: string | null;
      memberWebhookUrl?: string | null;
    };

    if (!webhookUrl?.trim()) throw new ServiceError('webhookUrl is required', 400);

    const config = await prisma.projectSlackConfig.upsert({
      where: { projectId },
      update: {
        webhookUrl: webhookUrl.trim(),
        ...(dailyEnabled !== undefined && { dailyEnabled }),
        ...(weeklyEnabled !== undefined && { weeklyEnabled }),
        ...(managerWebhookUrl !== undefined && { managerWebhookUrl: managerWebhookUrl || null }),
        ...(memberWebhookUrl !== undefined && { memberWebhookUrl: memberWebhookUrl || null }),
      },
      create: {
        projectId,
        webhookUrl: webhookUrl.trim(),
        dailyEnabled: dailyEnabled ?? true,
        weeklyEnabled: weeklyEnabled ?? true,
        managerWebhookUrl: managerWebhookUrl || null,
        memberWebhookUrl: memberWebhookUrl || null,
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

    const blocks = await buildDailyDigestBlocks(projectId, new Date());
    await sendSlackMessage(config.webhookUrl, blocks);

    sendSuccess(res, 200, { message: 'Test message sent to Slack' });
  } catch (err) {
    if (err instanceof ServiceError) { sendError(res, req, err.statusCode, codeFor(err.statusCode), err.message); return; }
    logger.error({ err }, 'testSlackConfig failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export default router;
