-- AlterTable
ALTER TABLE "project_slack_configs" ADD COLUMN     "lastDailySentKey" TEXT,
ADD COLUMN     "lastWeeklySentKey" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';
