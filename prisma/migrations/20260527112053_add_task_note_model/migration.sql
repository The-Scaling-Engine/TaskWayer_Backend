-- CreateTable
CREATE TABLE "task_notes" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_notes_taskId_idx" ON "task_notes"("taskId");

-- CreateIndex
CREATE INDEX "task_notes_authorId_idx" ON "task_notes"("authorId");

-- CreateIndex
CREATE INDEX "task_notes_taskId_createdAt_idx" ON "task_notes"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
