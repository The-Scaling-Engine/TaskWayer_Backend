import { RecurrenceType } from '@prisma/client';

export function calculateNextDeadline(current: Date, type: RecurrenceType): Date {
  const next = new Date(current);
  switch (type) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

const MAX_INSTANCES: Record<RecurrenceType, number> = {
  DAILY:   365,
  WEEKLY:   52,
  MONTHLY:  24,
  YEARLY:   10,
};

/**
 * Returns all future scheduledAt dates for a recurring task,
 * starting from the SECOND occurrence (the parent is the first).
 * Capped by recurrenceEndDate or the per-type max instance limit.
 */
export function generateRecurrenceDates(
  parentScheduledAt: Date,
  recurrenceType: RecurrenceType,
  recurrenceEndDate?: Date | null
): Date[] {
  const maxCount = MAX_INSTANCES[recurrenceType];
  const endLimit  = recurrenceEndDate ?? null;
  const dates: Date[] = [];
  let current = parentScheduledAt;

  for (let i = 0; i < maxCount; i++) {
    current = calculateNextDeadline(current, recurrenceType);
    if (endLimit && current > endLimit) break;
    dates.push(new Date(current));
  }

  return dates;
}
