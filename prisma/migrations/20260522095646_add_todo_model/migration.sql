-- CreateTable
CREATE TABLE "todos" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "todos_profileId_idx" ON "todos"("profileId");

-- CreateIndex
CREATE INDEX "todos_profileId_done_idx" ON "todos"("profileId", "done");

-- CreateIndex
CREATE INDEX "todos_createdAt_idx" ON "todos"("createdAt");

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
