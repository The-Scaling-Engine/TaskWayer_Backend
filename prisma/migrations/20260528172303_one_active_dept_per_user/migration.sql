-- Enforce "one active department per user" rule at DB level.
-- Partial index only covers rows WHERE status = 'ACTIVE',
-- so REMOVED records do not conflict.
CREATE UNIQUE INDEX "one_active_dept_per_user"
ON "department_members"("userId")
WHERE (status = 'ACTIVE');
