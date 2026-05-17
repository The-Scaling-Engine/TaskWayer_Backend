import nodemailer from 'nodemailer';
import logger from '../config/logger';

interface SendEmailOptions {
  email: string;
  subject: string;
  message: string;
  html?: string;
}

const sendEmail = async (options: SendEmailOptions): Promise<void> => {
  const host = (process.env.EMAIL_HOST || 'smtp.gmail.com').replace(/['"]/g, '').trim();
  const rawPort = (process.env.EMAIL_PORT || '').replace(/['"]/g, '').trim();
  const port = Number(rawPort) || 465;
  const user = (process.env.EMAIL_USER || '').replace(/['"]/g, '').trim();
  const pass = (process.env.EMAIL_PASS || '').replace(/['"]/g, '').trim();
  const fromEmail = (process.env.EMAIL_FROM || user).replace(/['"]/g, '').trim();
  const fromName = (process.env.EMAIL_FROM_NAME || 'MicroDo').replace(/['"]/g, '').trim();

  logger.info({ host, port, user: user.replace(/@.*/, '@...'), to: options.email }, 'Attempting to send email');

  // Create a transporter using SMTP
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 15_000,
    socketTimeout: 15_000,
    greetingTimeout: 15_000,
    logger: true,
    debug: true,
  });

  // Define email options
  const mailOptions = {
    from: `${fromName} <${fromEmail}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    ...(options.html && { html: options.html }),
  };

  // Send the email
  try {
    await transporter.sendMail(mailOptions);
    logger.info({ to: options.email }, 'Email sent successfully');
  } catch (error) {
    logger.error({ err: error, to: options.email, host, port }, 'SMTP sendMail failed');
    throw error;
  }
};

export default sendEmail;
