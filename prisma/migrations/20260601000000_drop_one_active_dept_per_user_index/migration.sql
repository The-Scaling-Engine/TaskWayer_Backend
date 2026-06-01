-- Drop the partial unique index that enforced "one active department per user".
-- Multi-department membership is now supported — a user can be ACTIVE in multiple departments simultaneously.
DROP INDEX IF EXISTS "one_active_dept_per_user";
