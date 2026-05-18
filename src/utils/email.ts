import { Resend } from 'resend';
import { env } from '../config/env';
import logger from '../config/logger';

interface SendEmailOptions {
  email: string;
  subject: string;
  message: string;
  html?: string;
}

const resend = new Resend(env.RESEND_API_KEY);

const sendEmail = async (options: SendEmailOptions): Promise<void> => {
  const { error } = await resend.emails.send({
    from:    env.EMAIL_FROM,
    to:      options.email,
    subject: options.subject,
    text:    options.message,
    ...(options.html && { html: options.html }),
  });

  if (error) {
    logger.error({ err: error, to: options.email }, 'Resend sendEmail failed');
    throw new Error(error.message);
  }

  logger.info({ to: options.email }, 'Email sent successfully via Resend');
};

export default sendEmail;
