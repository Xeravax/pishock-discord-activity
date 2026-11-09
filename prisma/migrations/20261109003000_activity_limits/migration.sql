-- AlterTable DiscordUser
ALTER TABLE "DiscordUser" ADD COLUMN "activityMaxIntensity" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "DiscordUser" ADD COLUMN "activityMaxDurationMs" INTEGER NOT NULL DEFAULT 15000;

-- AlterTable ActivityShare
ALTER TABLE "ActivityShare" ADD COLUMN "deviceMaxIntensity" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ActivityShare" ADD COLUMN "deviceMaxDurationMs" INTEGER NOT NULL DEFAULT 15000;
