-- DropIndex
DROP INDEX "task_notes_taskId_createdAt_idx";

-- AlterTable
ALTER TABLE "task_notes" ADD COLUMN     "done" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "task_notes_taskId_order_idx" ON "task_notes"("taskId", "order");
