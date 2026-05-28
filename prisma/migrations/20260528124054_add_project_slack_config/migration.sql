-- CreateTable
CREATE TABLE "project_slack_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "dailyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "managerWebhookUrl" TEXT,
    "memberWebhookUrl" TEXT,
    "dailyTime" TEXT NOT NULL DEFAULT '18:00',
    "weeklyDay" INTEGER NOT NULL DEFAULT 5,
    "weeklyTime" TEXT NOT NULL DEFAULT '17:00',

    CONSTRAINT "project_slack_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_slack_configs_projectId_key" ON "project_slack_configs"("projectId");

-- AddForeignKey
ALTER TABLE "project_slack_configs" ADD CONSTRAINT "project_slack_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
