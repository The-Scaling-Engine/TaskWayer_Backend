import { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import * as timesheetService from '../services/timesheetService';
import type { SummaryQuery, SessionsQuery } from '../schemas/timesheetSchemas';
import logger from '../config/logger';
import { sendError } from '../utils/apiResponse';

// GET /api/timesheet/summary?startDate=&endDate=&projectId=
export const getSummaryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, projectId } = res.locals.validated.query as SummaryQuery;
    const profileId = req.user!.prismaId;
    const data = await timesheetService.getSummary(profileId, startDate, endDate, projectId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getSummaryHandler failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

// GET /api/timesheet/sessions?startDate=&endDate=&projectId=&page=&limit=
export const getSessionsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, projectId, page, limit } = res.locals.validated.query as SessionsQuery;
    const profileId = req.user!.prismaId;
    const data = await timesheetService.getSessions(profileId, startDate, endDate, page, limit, projectId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, 'getSessionsHandler failed');
    sendError(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
