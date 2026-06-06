import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { notifyTaskAssigned } from '../services/notificationService';
import logger from '../config/logger';

const RAW_FE = (process.env.FRONTEND_URL ?? '').trim().replace(/\/$/, '');
const FRONTEND_URL = RAW_FE.startsWith('http') ? RAW_FE : `https://${RAW_FE}`;

type EmojiMappings = Record<string, string>;

export const handleSlackEmojiTask = async (req: Request, res: Response): Promise<void> => {
  try {
    // ── 1. Authenticate via secret-first lookup ───────────────────
    const secret = req.headers['x-webhook-secret'];
    if (!secret || typeof secret !== 'string') {
      sendError(res, req, 401, 'UNAUTHORIZED', 'Invalid or missing webhook secret');
      return;
    }

    const config = await prisma.projectSlackConfig.findFirst({
      where: { webhookSecret: secret },
    });
    if (!config) {
      sendError(res, req, 401, 'UNAUTHORIZED', 'Invalid or missing webhook secret');
      return;
    }

    // ── 2. Validate project ───────────────────────────────────────
    const project = await prisma.project.findUnique({
      where: { id: config.projectId },
    });
    if (!project || project.deletedAt) {
      sendError(res, req, 404, 'NOT_FOUND', 'Project not found');
      return;
    }
    if (project.archivedAt) {
      sendError(res, req, 400, 'BAD_REQUEST', 'Project is archived');
      return;
    }

    // ── 3. Resolve emoji → assigneeProfileId ─────────────────────
    const { emoji, title, milestoneId, columnId } = req.body as {
      emoji?: string;
      title?: string;
      milestoneId?: string;
      columnId?: string;
    };

    if (!emoji?.trim()) {
      sendError(res, req, 400, 'BAD_REQUEST', 'emoji is required');
      return;
    }

    const mappings = config.emojiMappings as EmojiMappings | null;
    if (!mappings || typeof mappings !== 'object') {
      sendError(res, req, 400, 'BAD_REQUEST', 'No emoji mappings configured for this project');
      return;
    }

    const assigneeProfileId = mappings[emoji.trim()];
    if (!assigneeProfileId) {
      sendError(res, req, 400, 'BAD_REQUEST', `Unknown emoji: ${emoji.trim()}`);
      return;
    }

    // ── 4. Validate title ─────────────────────────────────────────
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      sendError(res, req, 400, 'BAD_REQUEST', 'title is required');
      return;
    }
    if (trimmedTitle.length > 500) {
      sendError(res, req, 400, 'BAD_REQUEST', 'title must be 500 characters or fewer');
      return;
    }

    // ── 5. Resolve columnId — fallback to first column ────────────
    let resolvedColumnId = columnId ?? null;
    if (!resolvedColumnId) {
      const firstCol = await prisma.boardColumn.findFirst({
        where: { projectId: config.projectId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      resolvedColumnId = firstCol?.id ?? null;
    }

    // ── 6. Create task + fetch assignee name in parallel ─────────
    const [task, assigneeProfile] = await Promise.all([
      prisma.task.create({
        data: {
          title: trimmedTitle,
          status: 'todo',
          projectId: config.projectId,
          columnId: resolvedColumnId,
          milestoneId: milestoneId ?? null,
          assignedTo: assigneeProfileId,
          profileId: assigneeProfileId,
        },
      }),
      prisma.profile.findUnique({
        where: { id: assigneeProfileId },
        select: { name: true },
      }),
    ]);

    // ── 7. Notify assignee (fire-and-forget) ─────────────────────
    void notifyTaskAssigned({
      assigneeId: assigneeProfileId,
      actorId: assigneeProfileId,
      actorName: 'Slack Webhook',
      taskId: task.id,
      taskTitle: task.title,
      projectId: config.projectId,
    }).catch((err: unknown) => {
      logger.error({ err, taskId: task.id }, 'webhook: notifyTaskAssigned failed');
    });

    sendSuccess(res, 201, {
      data: {
        task,
        assigneeName: assigneeProfile?.name ?? null,
        taskUrl: `${FRONTEND_URL}/dashboard/projects/${config.projectId}/tasks?task=${task.id}`,
      },
    });
  } catch (err) {
    logger.error({ err }, 'handleSlackEmojiTask failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
