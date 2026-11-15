-- Personal + per-share minimum intensity / duration floors for Discord Activity.
ALTER TABLE "DiscordUser" ADD COLUMN "activityMinIntensity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DiscordUser" ADD COLUMN "activityMinDurationMs" INTEGER NOT NULL DEFAULT 16;

ALTER TABLE "ActivityShare" ADD COLUMN "minIntensity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ActivityShare" ADD COLUMN "minDurationMs" INTEGER NOT NULL DEFAULT 16;
