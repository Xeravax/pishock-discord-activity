-- Per-user log sharing preferences (who / what / where hits on you show up in the shared feed).
-- Defaults keep today's behaviour: visible everywhere with full details.
ALTER TABLE "DiscordUser" ADD COLUMN "logVisibility" TEXT NOT NULL DEFAULT 'everywhere';
ALTER TABLE "DiscordUser" ADD COLUMN "logShowSender" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logShowDevice" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logShowIntensity" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logShowLocation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logIncludeShock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logIncludeVibrate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logIncludeBeep" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logAllowShareCards" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiscordUser" ADD COLUMN "logHideMeAsSender" BOOLEAN NOT NULL DEFAULT false;
