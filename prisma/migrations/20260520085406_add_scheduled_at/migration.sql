-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_scheduledAt_idx" ON "tasks"("scheduledAt");

-- CreateIndex
CREATE INDEX "tasks_profileId_scheduledAt_idx" ON "tasks"("profileId", "scheduledAt");
