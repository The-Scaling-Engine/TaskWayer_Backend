import { RecurrenceType } from '@prisma/client';

export function calculateNextDeadline(
  current: Date,
  type: RecurrenceType,
  interval?: number | null
): Date {
  const n = interval && interval > 1 ? interval : 1;
  const next = new Date(current);
  switch (type) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + n);
      break;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7 * n);
      break;
    case 'BIWEEKLY':
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + n);
      break;
    case 'QUARTERLY':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

const MAX_INSTANCES: Record<RecurrenceType, number> = {
  DAILY:      365,
  WEEKLY:      52,
  BIWEEKLY:    26,
  MONTHLY:     24,
  QUARTERLY:    8,
  YEARLY:      10,
};

export function generateRecurrenceDates(
  parentScheduledAt: Date,
  recurrenceType: RecurrenceType,
  recurrenceEndDate?: Date | null,
  recurrenceInterval?: number | null
): Date[] {
  const interval  = recurrenceInterval && recurrenceInterval > 1 ? recurrenceInterval : 1;
  const baseMax   = MAX_INSTANCES[recurrenceType];
  const maxCount  = Math.max(1, Math.ceil(baseMax / interval));
  const endLimit  = recurrenceEndDate ?? null;
  const dates: Date[] = [];
  let current = parentScheduledAt;

  for (let i = 0; i < maxCount; i++) {
    current = calculateNextDeadline(current, recurrenceType, interval);
    if (endLimit && current > endLimit) break;
    dates.push(new Date(current));
  }

  return dates;
}
