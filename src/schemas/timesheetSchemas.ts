import { z } from 'zod';

const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function refineDateRange(
  data: { startDate: string; endDate: string },
  ctx: z.RefinementCtx,
) {
  const startMs = Date.parse(`${data.startDate}T00:00:00.000Z`);
  const endMs   = Date.parse(`${data.endDate}T00:00:00.000Z`);

  if (isNaN(startMs)) {
    ctx.addIssue({ code: 'custom', message: 'startDate is not a valid date', path: ['startDate'] });
    return;
  }
  if (isNaN(endMs)) {
    ctx.addIssue({ code: 'custom', message: 'endDate is not a valid date', path: ['endDate'] });
    return;
  }
  if (data.startDate > data.endDate) {
    ctx.addIssue({ code: 'custom', message: 'startDate must be <= endDate', path: ['startDate'] });
  }
  if (endMs - startMs > 365 * MS_PER_DAY) {
    ctx.addIssue({ code: 'custom', message: 'Date range cannot exceed 365 days', path: ['endDate'] });
  }
}

export const summaryQuerySchema = z
  .object({
    startDate: z.string().regex(DATE_RE, 'startDate must be YYYY-MM-DD'),
    endDate:   z.string().regex(DATE_RE, 'endDate must be YYYY-MM-DD'),
    projectId: z.string().uuid('Invalid projectId').optional(),
  })
  .superRefine(refineDateRange);

export const sessionsQuerySchema = z
  .object({
    startDate: z.string().regex(DATE_RE, 'startDate must be YYYY-MM-DD'),
    endDate:   z.string().regex(DATE_RE, 'endDate must be YYYY-MM-DD'),
    projectId: z.string().uuid('Invalid projectId').optional(),
    page:      z.coerce.number().int().min(1).default(1),
    limit:     z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine(refineDateRange);

export type SummaryQuery  = z.infer<typeof summaryQuerySchema>;
export type SessionsQuery = z.infer<typeof sessionsQuerySchema>;
