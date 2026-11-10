-- AlterTable
ALTER TABLE "DiscordUser" ADD COLUMN "commandQueueMaxPerSender" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "DiscordUser" ADD COLUMN "commandQueueMaxSenderMs" INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE "DiscordUser" ADD COLUMN "commandQueueStarOnly" BOOLEAN NOT NULL DEFAULT false;
