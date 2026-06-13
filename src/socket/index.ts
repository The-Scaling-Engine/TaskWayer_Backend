import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import prisma from '../config/prisma';
import supabaseAdmin from '../config/supabase';
import logger from '../config/logger';
import { env } from '../config/env';

export interface SocketUser {
  prismaId: string;
  role: string;
}

// ─── Socket join rate limiter ─────────────────────────────────

interface JoinCounter {
  count: number;
  resetAt: number;
}

const SOCKET_JOIN_MAX = 10;
const SOCKET_JOIN_WINDOW_MS = 30_000; // 30 seconds

// Map key: `${socketId}:task` or `${socketId}:dept`
const socketJoinCounters = new Map<string, JoinCounter>();

function checkJoinRateLimit(key: string): boolean {
  const now = Date.now();
  const counter = socketJoinCounters.get(key);

  if (counter == null || now >= counter.resetAt) {
    socketJoinCounters.set(key, { count: 1, resetAt: now + SOCKET_JOIN_WINDOW_MS });
    return true;
  }

  if (counter.count >= SOCKET_JOIN_MAX) return false;

  counter.count++;
  return true;
}

function cleanupSocketCounters(socketId: string): void {
  socketJoinCounters.delete(`${socketId}:task`);
  socketJoinCounters.delete(`${socketId}:dept`);
  socketJoinCounters.delete(`${socketId}:project`);
}

// ─────────────────────────────────────────────────────────────

// ─── Task presence (in-memory) ────────────────────────────────

interface PresenceUser {
  userId: string;
  name: string;
  avatar: string | null;
  isEditing: boolean;
  socketId: string;
}

// Map<taskId, Map<userId, PresenceUser>>
const taskPresence = new Map<string, Map<string, PresenceUser>>();

function broadcastPresence(taskId: string): void {
  if (!io) return;
  const users = taskPresence.get(taskId);
  const activeUsers = users
    ? Array.from(users.values()).map(({ socketId: _s, ...u }) => u)
    : [];
  logger.info({ taskId, userCount: activeUsers.length, userIds: activeUsers.map(u => u.userId) }, 'task:presence broadcast');
  io.to(`task:${taskId}`).emit('task:presence', { taskId, activeUsers });
}

// ─────────────────────────────────────────────────────────────

let io: SocketServer | null = null;

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
  });

  // ─── Auth middleware ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth as Record<string, unknown>)['token'] as string | undefined ??
        (socket.handshake.headers['authorization'] as string | undefined)?.replace('Bearer ', '');

      if (!token) {
        logger.warn({ ip: socket.handshake.address, reason: 'no_token' }, 'Socket auth rejected');
        return next(new Error('Authentication required'));
      }

      const { data: { user: supabaseUser }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !supabaseUser || !supabaseUser.email) {
        logger.warn({ ip: socket.handshake.address, reason: 'invalid_token' }, 'Socket auth rejected');
        return next(new Error('Invalid or expired token'));
      }

      const profile = await prisma.profile.findUnique({
        where: { email: supabaseUser.email },
        select: { id: true, role: true, status: true },
      });

      if (!profile) {
        logger.warn({ ip: socket.handshake.address, reason: 'user_not_found' }, 'Socket auth rejected');
        return next(new Error('User not found'));
      }

      if (profile.status === 'BANNED') {
        logger.warn({ userId: profile.id, reason: 'banned' }, 'Socket auth rejected');
        return next(new Error('Account is banned'));
      }

      (socket.data as { user: SocketUser }).user = {
        prismaId: profile.id,
        role:     profile.role,
      };

      next();
    } catch {
      logger.warn({ ip: socket.handshake.address, reason: 'auth_error' }, 'Socket auth rejected');
      next(new Error('Invalid or expired token'));
    }
  });

  // ─── Connection handler ───────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user: SocketUser }).user;

    logger.info({ userId: user.prismaId, role: user.role }, 'Socket connected');

    // Auto-join personal room
    void socket.join(`user:${user.prismaId}`);

    // ─── Join task room ───────────────────────────────────────
    socket.on('join:task', async (taskId: string) => {
      if (!checkJoinRateLimit(`${socket.id}:task`)) {
        socket.emit('error', {
          code: 'SOCKET_RATE_LIMIT',
          message: 'Too many room join attempts',
        });
        return;
      }

      try {
        if (typeof taskId !== 'string' || !taskId.trim()) return;

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { id: true, profileId: true },
        });

        if (!task) return;

        if (user.role === 'ADMIN') {
          void socket.join(`task:${taskId}`);
          return;
        }

        if (task.profileId === user.prismaId) {
          void socket.join(`task:${taskId}`);
          return;
        }
      } catch (err) {
        logger.error({ err, userId: user.prismaId, taskId }, 'Socket join:task failed');
      }
    });

    // ─── Join department room ─────────────────────────────────
    socket.on('join:department', async (departmentId: string) => {
      if (!checkJoinRateLimit(`${socket.id}:dept`)) {
        socket.emit('error', {
          code: 'SOCKET_RATE_LIMIT',
          message: 'Too many room join attempts',
        });
        return;
      }

      try {
        if (typeof departmentId !== 'string' || !departmentId.trim()) return;

        if (user.role === 'ADMIN') {
          void socket.join(`department:${departmentId}`);
          return;
        }

        const membership = await prisma.departmentMember.findUnique({
          where: {
            userId_departmentId: {
              userId: user.prismaId,
              departmentId,
            },
          },
          select: { status: true },
        });

        if (membership?.status === 'ACTIVE') {
          void socket.join(`department:${departmentId}`);
        }
      } catch (err) {
        logger.error({ err, userId: user.prismaId, departmentId }, 'Socket join:department failed');
      }
    });

    // ─── Join project room ────────────────────────────────────
    socket.on('join:project', async (projectId: string) => {
      if (!checkJoinRateLimit(`${socket.id}:project`)) {
        socket.emit('error', {
          code: 'SOCKET_RATE_LIMIT',
          message: 'Too many room join attempts',
        });
        return;
      }

      try {
        if (typeof projectId !== 'string' || !projectId.trim()) return;

        if (user.role === 'ADMIN') {
          void socket.join(`project:${projectId}`);
          return;
        }

        const membership = await prisma.projectMember.findFirst({
          where: { projectId, profileId: user.prismaId },
          select: { id: true },
        });

        if (membership) {
          void socket.join(`project:${projectId}`);
        }
      } catch (err) {
        logger.error({ err, userId: user.prismaId, projectId }, 'Socket join:project failed');
      }
    });

    // ─── Task presence ────────────────────────────────────────
    socket.on('task:join', async (payload: { taskId: string; name?: string; avatar?: string | null }) => {
      logger.info({ userId: user.prismaId, socketId: socket.id, payload }, 'task:join received');
      if (!payload || typeof payload.taskId !== 'string' || !payload.taskId.trim()) return;
      const { taskId, name = '', avatar = null } = payload;

      await socket.join(`task:${taskId}`);

      if (!taskPresence.has(taskId)) taskPresence.set(taskId, new Map());
      taskPresence.get(taskId)!.set(user.prismaId, {
        userId: user.prismaId,
        name,
        avatar,
        isEditing: false,
        socketId: socket.id,
      });

      broadcastPresence(taskId);
      logger.info({ userId: user.prismaId, taskId }, 'task:join presence updated');
    });

    socket.on('task:leave', (payload: { taskId: string }) => {
      if (!payload || typeof payload.taskId !== 'string') return;
      const { taskId } = payload;

      void socket.leave(`task:${taskId}`);

      taskPresence.get(taskId)?.delete(user.prismaId);
      if (taskPresence.get(taskId)?.size === 0) taskPresence.delete(taskId);

      broadcastPresence(taskId);
    });

    socket.on('task:editing', (payload: { taskId: string; field: string }) => {
      if (!payload || typeof payload.taskId !== 'string') return;
      const { taskId } = payload;

      const entry = taskPresence.get(taskId)?.get(user.prismaId);
      if (!entry) return;

      entry.isEditing = true;
      broadcastPresence(taskId);

      // Auto-clear editing flag after 3 s of inactivity
      setTimeout(() => {
        const e = taskPresence.get(taskId)?.get(user.prismaId);
        if (e && e.socketId === socket.id) {
          e.isEditing = false;
          broadcastPresence(taskId);
        }
      }, 3000);
    });

    socket.on('disconnect', (reason: string) => {
      cleanupSocketCounters(socket.id);

      // Remove from all task presence maps
      for (const [taskId, users] of taskPresence) {
        if (users.get(user.prismaId)?.socketId === socket.id) {
          users.delete(user.prismaId);
          if (users.size === 0) taskPresence.delete(taskId);
          else broadcastPresence(taskId);
        }
      }

      logger.info({ userId: user.prismaId, reason }, 'Socket disconnected');
    });
  });

  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
