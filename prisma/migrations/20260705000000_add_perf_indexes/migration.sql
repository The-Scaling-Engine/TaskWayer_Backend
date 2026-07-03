-- Migration: add_perf_indexes
--
-- Context:
--   Sprint 1 performance work — add indexes for hot query patterns identified
--   during the perf audit (docs/faster.md).
--
-- Idempotency:
--   All statements use IF NOT EXISTS so the migration is safe to re-run and safe
--   to apply on databases that already carry the index (e.g. if someone ran
--   `prisma db push` locally before the migration file was committed).

-- ── tasks ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "tasks_assignedTo_idx"
  ON "tasks"("assignedTo");

CREATE INDEX IF NOT EXISTS "tasks_assignedBy_idx"
  ON "tasks"("assignedBy");

-- Compound index for findUnassignedByProject:
--   WHERE projectId = ? AND parentTaskId IS NULL AND milestoneId IS NULL
CREATE INDEX IF NOT EXISTS "tasks_projectId_parentTaskId_milestoneId_idx"
  ON "tasks"("projectId", "parentTaskId", "milestoneId");

-- ── department_members ───────────────────────────────────────────────
-- Compound index for projectService.getMyProjects filter:
--   WHERE userId = ? AND status = 'ACTIVE' AND role IN (...)
CREATE INDEX IF NOT EXISTS "department_members_userId_status_role_idx"
  ON "department_members"("userId", "status", "role");

-- ── notifications ────────────────────────────────────────────────────
-- Compound index for deadlineNotificationJob dedup query:
--   WHERE userId = ? AND type = ? AND entityId = ?
CREATE INDEX IF NOT EXISTS "notifications_userId_type_entityId_idx"
  ON "notifications"("userId", "type", "entityId");
