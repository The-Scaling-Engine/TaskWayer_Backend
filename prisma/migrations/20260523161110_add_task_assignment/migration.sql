-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assignedBy" TEXT,
ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "isAssigned" BOOLEAN NOT NULL DEFAULT false;
