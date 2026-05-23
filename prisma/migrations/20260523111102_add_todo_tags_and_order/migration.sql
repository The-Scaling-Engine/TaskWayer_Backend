-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[];
