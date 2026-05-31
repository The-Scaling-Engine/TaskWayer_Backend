-- Drop departmentId indexes
DROP INDEX IF EXISTS "tasks_departmentId_idx";
DROP INDEX IF EXISTS "tasks_departmentId_status_idx";
DROP INDEX IF EXISTS "tasks_departmentId_completedAt_idx";

-- Drop foreign key constraint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_departmentId_fkey";

-- Drop columns
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "departmentId";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "isAssigned";
