-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MILESTONE_COMPLETED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "inProgressAt" TIMESTAMP(3),
ADD COLUMN     "milestoneId" TEXT,
ADD COLUMN     "milestoneOrder" INTEGER,
ADD COLUMN     "parentTaskId" TEXT;

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'ACTIVE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "milestones_projectId_order_idx" ON "milestones"("projectId", "order");

-- CreateIndex
CREATE INDEX "milestones_status_idx" ON "milestones"("status");

-- CreateIndex
CREATE INDEX "tasks_milestoneId_idx" ON "tasks"("milestoneId");

-- CreateIndex
CREATE INDEX "tasks_milestoneId_milestoneOrder_idx" ON "tasks"("milestoneId", "milestoneOrder");

-- CreateIndex
CREATE INDEX "tasks_parentTaskId_idx" ON "tasks"("parentTaskId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
