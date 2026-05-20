import type { Request, Response } from 'express';
import supabaseAdmin from '../config/supabase';
import { env } from '../config/env';
import logger from '../config/logger';
import sendEmail from '../utils/email';
import type { ForgotPasswordInput } from '../schemas/authSchemas';

// ─── Reset password email template ────────────────────────────────────────────

const buildResetPasswordEmail = (resetLink: string): string => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#eff6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;padding:48px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <tr>
          <td style="background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);border-radius:16px 16px 0 0;padding:28px 40px;text-align:center;">
            <span style="font-size:22px;font-weight:800;color:#ffffff;">&#128274; Task Wayer</span>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;padding:40px;border-left:1px solid #dbeafe;border-right:1px solid #dbeafe;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">Password Reset</p>
            <h1 style="margin:0 0 20px;font-size:26px;font-weight:800;color:#111827;">Reset your password</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
              We received a request to reset your <strong style="color:#2563eb;">Task Wayer</strong> password.<br><br>
              Click the button below to choose a new password. If you didn't request this, you can safely ignore this email — your account is still secure.
            </p>

            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="border-radius:12px;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);box-shadow:0 4px 14px rgba(59,130,246,0.35);">
                  <a href="${resetLink}" style="display:inline-block;padding:16px 44px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">
                    Reset My Password &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;">
                  <p style="margin:0;font-size:13px;color:#1e40af;">&#9200; This link expires in <strong>1 hour</strong>. If it expires, visit the login page and request a new reset link.</p>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.6;">
              Button not working? Copy this link:<br>
              <a href="${resetLink}" style="color:#3b82f6;word-break:break-all;font-size:11px;">${resetLink}</a>
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#f9fafb;border:1px solid #dbeafe;border-top:0;border-radius:0 0 16px 16px;padding:22px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              You received this because a password reset was requested for your <strong>Task Wayer</strong> account.<br>
              If you didn't request this, you can safely ignore this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Handler ───────────────────────────────────────────────────────────────────

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = res.locals.validated.body as ForgotPasswordInput;

  // Always return 200 to prevent email enumeration — errors are logged only
  const okResponse = { success: true, message: 'If that email is registered, a reset link has been sent.' };

  try {
    const redirectTo = `${env.CLIENT_URL}/reset-password`;

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });

    if (error || !data?.properties?.action_link) {
      logger.warn({ email, supabaseError: error?.message }, 'forgot-password: user not found or generateLink failed');
      res.status(200).json(okResponse);
      return;
    }

    const resetLink = data.properties.action_link;

    sendEmail({
      email,
      subject: 'Reset your Task Wayer password',
      message: `Reset your password here: ${resetLink}`,
      html: buildResetPasswordEmail(resetLink),
    }).catch((err: unknown) =>
      logger.error({ err, email }, 'forgot-password: email send failed')
    );

    res.status(200).json(okResponse);
  } catch (err) {
    logger.error({ err, email }, 'forgot-password: unexpected error');
    res.status(200).json(okResponse);
  }
};
