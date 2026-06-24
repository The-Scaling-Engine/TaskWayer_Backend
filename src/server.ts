import { env } from './config/env';
import express, { Request, Response, NextFunction } from 'express';
import { mountSwagger } from './docs/swagger';
import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import logger from './config/logger';
import { requestIdMiddleware } from './middleware/requestId';
import { requestTimeout } from './middleware/requestTimeout';
import { authLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/authRoutes';
import taskRoutes from './routes/taskRoutes';
import userRoutes from './routes/userRoutes';
import adminRoutes from './routes/adminRoutes';
import adminTeamRoutes from './routes/adminTeamRoutes';
import departmentRoutes from './routes/departmentRoutes';
import membershipRoutes from './routes/membershipRoutes';
import invitationRoutes from './routes/invitationRoutes';
import commentRoutes from './routes/commentRoutes';
import notificationRoutes from './routes/notificationRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import adminAnalyticsRoutes from './routes/adminAnalyticsRoutes';
import timeTrackingRoutes from './routes/timeTrackingRoutes';
import timesheetRoutes from './routes/timesheetRoutes';
import todoRoutes from './routes/todoRoutes';
import uploadRoutes from './routes/uploadRoutes';
import projectRoutes from './routes/projectRoutes';
import taskNoteRoutes from './routes/taskNoteRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { protect, AuthRequest } from './middleware/authMiddleware';
import { initSocket, getIO } from './socket/index';
import prisma from './config/prisma';
import { sendError } from './utils/apiResponse';
import { startDeadlineNotificationJob } from './jobs/deadlineNotificationJob';
import { startSlackCronJob } from './jobs/slackCronJob';

const app = express();

// ─── Trust proxy (must be before rate limiters) ───────────────
// Set to 1 when running behind a single reverse proxy (nginx, etc.)
// Remove or set to false if running without a proxy
app.set('trust proxy', 1);

// ─── 1. Request ID (very first — stamps every response) ──────
app.use(requestIdMiddleware);

// ─── 2. Security headers ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,                        // API server — no HTML to protect
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow cross-origin API calls
}));

// ─── 3. CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.trim().replace(/\/$/, '');
    if (env.FRONTEND_URL.includes(cleanOrigin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['x-request-id'],
}));

// ─── 4. Request logging ───────────────────────────────────────
app.use(pinoHttp({
  logger,
  genReqId: (req: IncomingMessage) =>
    (req as { requestId?: string }).requestId ?? crypto.randomUUID(),
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error): string => {
    if (err != null || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (req: { method: string; url: string; id: unknown }) => ({
      id:     req.id,
      method: req.method,
      url:    req.url,
    }),
    res: (res: { statusCode: number }) => ({
      statusCode: res.statusCode,
    }),
  },
}));

// ─── 5. Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ─── 6. Compression ───────────────────────────────────────────
app.use(compression());

// ─── 7. Request timeout ───────────────────────────────────────
app.use(requestTimeout);

// ─── 8. Routes ────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/team', adminTeamRoutes);
app.use('/api/admin/departments', departmentRoutes);
app.use('/api/departments', membershipRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api', commentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/time-tracking', timeTrackingRoutes);
app.use('/api/timesheet', timesheetRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', taskNoteRoutes);
app.use('/api/webhooks', webhookRoutes);

// ─── 9. Swagger UI (development only) ────────────────────────
if (env.NODE_ENV === 'development') {
  mountSwagger(app);
}

// Protected test route
app.get('/api/protected', protect, (req: AuthRequest, res: Response) => {
  res.json({ success: true, message: 'You have access to this protected route', data: { user: req.user } });
});

// Health checks — excluded from rate limiting and logging noise
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Welcome to Wayer Ops Backend API', status: 'online', version: '1.0.0' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 8. Global error handler ──────────────────────────────────
// Catches any unhandled errors passed via next(err)
// Must have 4 params so Express recognises it as an error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
  if (res.headersSent) return;
  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  sendError(res, req, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

// ─── HTTP Server + Socket.IO ──────────────────────────────────
const httpServer = createServer(app);
initSocket(httpServer);

// ─── Background jobs ──────────────────────────────────────────
startDeadlineNotificationJob();
startSlackCronJob();

// ─── Graceful shutdown ────────────────────────────────────────
let isShuttingDown = false;

async function gracefulShutdown(signal: string, exitCode: number): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received');

  const forceExitTimeout = setTimeout(() => {
    logger.error({ signal }, 'Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExitTimeout.unref();

  try { getIO().close(); } catch { /* not initialized */ }

  httpServer.closeAllConnections?.();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));

  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, 'Prisma disconnect error during shutdown');
  }

  clearTimeout(forceExitTimeout);
  logger.info('Graceful shutdown complete');
  process.exit(exitCode);
}

process.on('SIGINT',  () => void gracefulShutdown('SIGINT',  0));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  void gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err: error }, 'Unhandled rejection');
  void gracefulShutdown('unhandledRejection', 1);
});

httpServer.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT }, 'Server started on 0.0.0.0');
});

export default app;
