-- Soft API key expiry (null = keep until PiShock rejects)
ALTER TABLE "PiShockSession" ALTER COLUMN "expiresAt" DROP NOT NULL;

-- Personal vibrate / beep bands + required warning
ALTER TABLE "DiscordUser" ADD COLUMN "activityVibMinIntensity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DiscordUser" ADD COLUMN "activityVibMaxIntensity" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "DiscordUser" ADD COLUMN "activityVibMinDurationMs" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "DiscordUser" ADD COLUMN "activityVibMaxDurationMs" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "DiscordUser" ADD COLUMN "activityBeepMinIntensity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DiscordUser" ADD COLUMN "activityBeepMaxIntensity" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "DiscordUser" ADD COLUMN "activityBeepMinDurationMs" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "DiscordUser" ADD COLUMN "activityBeepMaxDurationMs" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "DiscordUser" ADD COLUMN "activityRequiredWarningLevel" TEXT NOT NULL DEFAULT 'none';

-- Per-share vibrate / beep bands + required warning
ALTER TABLE "ActivityShare" ADD COLUMN "vibMinIntensity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ActivityShare" ADD COLUMN "vibMaxIntensity" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ActivityShare" ADD COLUMN "vibMinDurationMs" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "ActivityShare" ADD COLUMN "vibMaxDurationMs" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "ActivityShare" ADD COLUMN "beepMinIntensity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ActivityShare" ADD COLUMN "beepMaxIntensity" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ActivityShare" ADD COLUMN "beepMinDurationMs" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "ActivityShare" ADD COLUMN "beepMaxDurationMs" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "ActivityShare" ADD COLUMN "requiredWarningLevel" TEXT NOT NULL DEFAULT 'none';
