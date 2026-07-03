import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';
import * as timeTrackingService from '../services/timeTrackingService';
import * as notificationService from '../services/notificationService';
import * as projectService from '../services/projectService';

const profileSelect = {
  id:        true,
  email:     true,
  name:      true,
  username:  true,
  avatar:    true,
  jobTitle:  true,
  role:      true,
  status:    true,
  mongoId:   true,
  createdAt: true,
  updatedAt: true,
} as const;

// Aggregates the 5 endpoints DashboardLayout used to fetch in parallel:
//   GET /user/profile, /time-tracking/sessions/active, /user/memberships,
//   /notifications/unread-count, /projects
//
// Under the previous fan-out, each request paid separate auth + Prisma round-trips.
// Consolidating cuts 5 requests to 1 and shares the auth middleware cost.
export const getBootstrap = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profileId = req.user!.prismaId;
    const userId    = req.user!.id;
    const isAdmin   = req.user!.role === 'ADMIN';

    const [profile, activeSession, memberships, unreadCount, projects] = await Promise.all([
      prisma.profile.findUnique({ where: { id: profileId }, select: profileSelect }),
      timeTrackingService.getActiveSession(profileId).catch(err => {
        logger.warn({ err, context: 'bootstrap:getActiveSession' }, 'partial failure');
        return null;
      }),
      // Admin doesn't consume memberships in the dashboard — skip the query
      isAdmin ? Promise.resolve([]) : prisma.departmentMember.findMany({
        where:   { userId: profileId, status: 'ACTIVE' },
        include: { department: true },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      }).catch(err => {
        logger.warn({ err, context: 'bootstrap:memberships' }, 'partial failure');
        return [];
      }),
      notificationService.getUnreadCount(profileId).catch(err => {
        logger.warn({ err, context: 'bootstrap:getUnreadCount' }, 'partial failure');
        return 0;
      }),
      isAdmin ? Promise.resolve([]) : projectService.getMyProjects(userId).catch(err => {
        logger.warn({ err, context: 'bootstrap:getMyProjects' }, 'partial failure');
        return [];
      }),
    ]);

    if (!profile) {
      sendError(res, req, 404, 'NOT_FOUND', 'User no longer exists');
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        profile: {
          _id:       profile.mongoId,
          id:        profile.id,
          email:     profile.email,
          name:      profile.name,
          username:  profile.username,
          avatar:    profile.avatar,
          jobTitle:  profile.jobTitle,
          role:      profile.role,
          status:    profile.status,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          __v: 0,
        },
        activeSession,
        memberships: memberships.map((m) => ({
          id:       m.id,
          role:     m.role,
          status:   m.status,
          joinedAt: m.joinedAt,
          department: {
            id:          m.department.id,
            name:        m.department.name,
            description: m.department.description,
          },
        })),
        unreadCount,
        projects,
      },
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getBootstrap failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
