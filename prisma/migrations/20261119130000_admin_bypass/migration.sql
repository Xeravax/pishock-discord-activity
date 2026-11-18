-- Admin bypass: wearer consent for admins exceeding limits, and bypass markers on logs.
ALTER TABLE "DiscordUser" ADD COLUMN "adminLimitOverrideConsentAt" TIMESTAMP(3);
ALTER TABLE "DiscordUser" ADD COLUMN "adminLimitOverrideConsentVersion" INTEGER;
ALTER TABLE "CommandLog" ADD COLUMN "adminBypass" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommandLog" ADD COLUMN "bypassedGates" TEXT[] DEFAULT ARRAY[]::TEXT[];
