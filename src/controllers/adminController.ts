import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { prisma } from '../config/prisma';
import supabaseAdmin from '../config/supabase';
import { env } from '../config/env';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';
import sendEmail from '../utils/email';
import type { GetUsersQuery, CreateUserInput } from '../schemas/adminSchemas';

const buildInviteEmail = (inviteLink: string): string => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f0fdf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;padding:48px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#10BA41 0%,#047857 100%);border-radius:16px 16px 0 0;padding:28px 40px;text-align:center;">
            <span style="font-size:22px;font-weight:800;color:#ffffff;">&#10003; TasksWayero</span>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:40px;border-left:1px solid #d1fae5;border-right:1px solid #d1fae5;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">Invitation</p>
            <h1 style="margin:0 0 20px;font-size:26px;font-weight:800;color:#111827;">You've been invited!</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
              An administrator has created an account for you on <strong style="color:#059669;">TasksWayero</strong>.<br><br>
              Click the button below to set up your password and get started.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="border-radius:12px;background:linear-gradient(135deg,#10BA41 0%,#059669 100%);box-shadow:0 4px 14px rgba(16,186,65,0.35);">
                  <a href="${inviteLink}" style="display:inline-block;padding:16px 44px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">
                    Set Up My Password &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;">
                  <p style="margin:0;font-size:13px;color:#166534;">&#9200; This link expires in <strong>1 hour</strong>. If it expires, ask your administrator to resend the invitation.</p>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.6;">
              Button not working? Copy this link:<br>
              <a href="${inviteLink}" style="color:#10BA41;word-break:break-all;font-size:11px;">${inviteLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border:1px solid #d1fae5;border-top:0;border-radius:0 0 16px 16px;padding:22px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              You received this because an administrator invited you to <strong>TasksWayero</strong>.<br>
              If you didn't expect this, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalUsers, bannedUsers, totalTasks] = await Promise.all([
      prisma.profile.count(),
      prisma.profile.count({ where: { status: 'BANNED' } }),
      prisma.task.count(),
    ]);

    res.status(200).json({ success: true, data: { totalUsers, bannedUsers, totalTasks } });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getDashboard failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, search } = res.locals.validated.query as GetUsersQuery;
    const skip = (page - 1) * limit;

    const where = search !== undefined
      ? { email: { contains: search, mode: 'insensitive' as const } }
      : {};

    const [totalUsers, profiles] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        select: {
          id:        true,
          mongoId:   true,
          email:     true,
          name:      true,
          username:  true,
          jobTitle:  true,
          role:      true,
          status:    true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const users = profiles.map(p => ({
      _id:       p.mongoId,
      id:        p.id,
      email:     p.email,
      name:      p.name,
      username:  p.username,
      jobTitle:  p.jobTitle,
      role:      p.role,
      status:    p.status,
      createdAt: p.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages:  Math.ceil(totalUsers / limit),
          totalUsers,
          limit,
        },
      },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getUsers failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const banUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userIdToBan = req.params['id'] as string;

    if (userIdToBan === req.user!.prismaId) {
      sendError(res, req, 403, 'FORBIDDEN', 'Admin cannot ban themselves');
      return;
    }

    const profile = await prisma.profile.findUnique({ where: { id: userIdToBan } });
    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    await prisma.profile.update({ where: { id: profile.id }, data: { status: 'BANNED' } });

    res.status(200).json({
      success: true,
      message: 'User has been banned',
      data: { _id: profile.mongoId, id: profile.id, email: profile.email, status: 'BANNED' },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'banUser failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const unbanUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userIdToUnban = req.params['id'] as string;

    const profile = await prisma.profile.findUnique({ where: { id: userIdToUnban } });
    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    await prisma.profile.update({ where: { id: profile.id }, data: { status: 'ACTIVE' } });

    res.status(200).json({
      success: true,
      message: 'User has been unbanned',
      data: { _id: profile.mongoId, id: profile.id, email: profile.email, status: 'ACTIVE' },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'unbanUser failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  let supabaseUserId: string | null = null;
  let profileId: string | null = null;

  try {
    const { name, username, email } = res.locals.validated.body as CreateUserInput;

    // Check uniqueness in our DB
    const existing = await prisma.profile.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true, username: true },
    });
    if (existing?.email === email) {
      sendError(res, req, 409, 'CONFLICT', 'Email already in use');
      return;
    }
    if (existing?.username === username) {
      sendError(res, req, 409, 'CONFLICT', 'Username already in use');
      return;
    }

    // Generate invite link via Supabase (creates user + returns action_link for manual delivery)
    const { data, error: supabaseError } = await supabaseAdmin.auth.admin.generateLink({
      type:    'invite',
      email,
      options: { data: { name, username }, redirectTo: `${env.CLIENT_URL}/reset-password` },
    });

    if (supabaseError || !data?.user) {
      logger.error({ err: supabaseError, email }, 'Supabase generateLink failed');
      sendError(res, req, 500, 'INTERNAL_ERROR', 'Failed to generate invitation link. Please try again.');
      return;
    }

    supabaseUserId = data.user.id;
    const inviteLink = data.properties.action_link;

    // Create Profile in our DB
    const profile = await prisma.profile.create({
      data: {
        email,
        name,
        username,
        supabaseId: supabaseUserId,
        role:   'USER',
        status: 'PENDING',
      },
    });
    profileId = profile.id;

    // Send invite email via Resend HTTP API (same mechanism as deadline notifications)
    await sendEmail({
      email,
      subject: 'You have been invited to TasksWayero',
      message: `You have been invited to TasksWayero. Click here to set up your password: ${inviteLink}`,
      html:    buildInviteEmail(inviteLink),
    });

    logger.info({ adminId: req.user!.prismaId, newUserId: profile.id, email }, 'Admin created new user');

    res.status(201).json({
      success: true,
      message: 'User account created. An activation email has been sent.',
      data: {
        id:        profile.id,
        name:      profile.name,
        username:  profile.username,
        email:     profile.email,
        role:      profile.role,
        status:    profile.status,
        createdAt: profile.createdAt,
      },
    });
  } catch (error) {
    if (profileId) await prisma.profile.delete({ where: { id: profileId } }).catch(() => {});
    if (supabaseUserId) await supabaseAdmin.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    logger.error({ err: error, requestId: req.requestId }, 'createUser failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

export const resendInvite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profileId = req.params['id'] as string;

    const profile = await prisma.profile.findUnique({
      where:  { id: profileId },
      select: { id: true, email: true, status: true, supabaseId: true },
    });

    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    if (profile.status !== 'PENDING') {
      sendError(res, req, 400, 'BAD_REQUEST', 'User has already joined the system');
      return;
    }

    const { data, error: supabaseError } = await supabaseAdmin.auth.admin.generateLink({
      type:    'invite',
      email:   profile.email,
      options: { redirectTo: `${env.CLIENT_URL}/reset-password` },
    });

    if (supabaseError || !data?.properties?.action_link) {
      logger.error({ err: supabaseError, email: profile.email }, 'Supabase generateLink failed on resend');
      sendError(res, req, 500, 'INTERNAL_ERROR', 'Failed to generate invitation link. Please try again.');
      return;
    }

    await sendEmail({
      email:   profile.email,
      subject: 'You have been invited to TasksWayero',
      message: `You have been invited to TasksWayero. Click here to set up your password: ${data.properties.action_link}`,
      html:    buildInviteEmail(data.properties.action_link),
    });

    logger.info({ adminId: req.user!.prismaId, targetUserId: profile.id, email: profile.email }, 'Admin resent invite');

    res.status(200).json({ success: true, message: 'Invitation resent successfully' });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'resendInvite failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
