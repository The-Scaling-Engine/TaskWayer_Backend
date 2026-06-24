-- Migration: add_manager_role
--
-- Context:
--   MANAGER was added to the Role enum via prisma db push locally but was never
--   captured in a migration file, so Railway DB still has only USER/ADMIN
--   plus the legacy DEPT_MANAGER/DEPT_MEMBER values from the init migration.
--
-- Idempotency:
--   Step 1 casts the enum column to text for comparison so the WHERE clause does
--   not fail on databases that have already dropped DEPT_MANAGER/DEPT_MEMBER.
--   Step 2 guards the ALTER TYPE with a pg_enum existence check.

-- Step 1: migrate legacy role values (cast to text avoids enum validation on
--         databases that no longer carry those values)
UPDATE "profiles"
SET    "role" = 'USER'
WHERE  "role"::text IN ('DEPT_MANAGER', 'DEPT_MEMBER');

-- Step 2: add MANAGER to the Role enum if it does not already exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Role' AND e.enumlabel = 'MANAGER'
  ) THEN
    ALTER TYPE "Role" ADD VALUE 'MANAGER';
  END IF;
END $$;
