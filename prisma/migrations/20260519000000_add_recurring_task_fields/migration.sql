-- Add new NotificationType values for deadline windows
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE_3D';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE_2D';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE_1D';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE_12H';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE_4H';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE_1H';

-- Create RecurrenceType enum
DO $$ BEGIN
  CREATE TYPE "RecurrenceType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add recurring fields to tasks table
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "isRecurring"        BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "recurrenceType"      "RecurrenceType",
  ADD COLUMN IF NOT EXISTS "recurrenceEndDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recurrenceParentId"  TEXT;

-- Add indexes
CREATE INDEX IF NOT EXISTS "tasks_deadline_idx"             ON "tasks"("deadline");
CREATE INDEX IF NOT EXISTS "tasks_recurrenceParentId_idx"   ON "tasks"("recurrenceParentId");
