-- AlterTable
ALTER TABLE "project_slack_configs" ADD COLUMN     "emojiMappings" JSONB,
ADD COLUMN     "webhookSecret" TEXT;
