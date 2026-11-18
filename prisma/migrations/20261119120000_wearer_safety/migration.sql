-- Extra features: wearer safety gates (approve-each, cooldowns, favorites-only, budget,
-- check-ins, per-person limits, per-shocker escalation cap). Defaults keep today's behaviour.

-- "Stars only" becomes the global "Favorites only" setting (keeps existing values).
ALTER TABLE "DiscordUser" RENAME COLUMN "commandQueueStarOnly" TO "favoritesOnly";

ALTER TABLE "DiscordUser" ADD COLUMN "approveEachCommand" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscordUser" ADD COLUMN "approvalTimeoutMs" INTEGER NOT NULL DEFAULT 20000;
ALTER TABLE "DiscordUser" ADD COLUMN "cooldownPerSenderMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiscordUser" ADD COLUMN "cooldownGlobalMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiscordUser" ADD COLUMN "budgetEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscordUser" ADD COLUMN "budgetPeriod" TEXT NOT NULL DEFAULT 'session';
ALTER TABLE "DiscordUser" ADD COLUMN "budgetMaxShocks" INTEGER;
ALTER TABLE "DiscordUser" ADD COLUMN "budgetMaxShockMs" INTEGER;
ALTER TABLE "DiscordUser" ADD COLUMN "budgetUsedShocks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiscordUser" ADD COLUMN "budgetUsedShockMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiscordUser" ADD COLUMN "budgetPeriodStartedAt" TIMESTAMP(3);
ALTER TABLE "DiscordUser" ADD COLUMN "budgetTimezone" TEXT;
ALTER TABLE "DiscordUser" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "DiscordUser" ADD COLUMN "checkInEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscordUser" ADD COLUMN "checkInIntervalMs" INTEGER NOT NULL DEFAULT 900000;
ALTER TABLE "DiscordUser" ADD COLUMN "checkInGraceMs" INTEGER NOT NULL DEFAULT 60000;
ALTER TABLE "DiscordUser" ADD COLUMN "perPersonLimitsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Per-shocker escalation cap.
ALTER TABLE "ActivityShare" ADD COLUMN "maxIntensityStep" INTEGER;

-- Per-person limits.
CREATE TABLE "ActivityPersonLimit" (
    "id" TEXT NOT NULL,
    "ownerDiscordUserId" TEXT NOT NULL,
    "controllerDiscordUserId" TEXT NOT NULL,
    "shockMaxIntensity" INTEGER,
    "shockMaxDurationMs" INTEGER,
    "vibMaxIntensity" INTEGER,
    "vibMaxDurationMs" INTEGER,
    "beepMaxIntensity" INTEGER,
    "beepMaxDurationMs" INTEGER,
    "canShock" BOOLEAN NOT NULL DEFAULT true,
    "canVibrate" BOOLEAN NOT NULL DEFAULT true,
    "canBeep" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityPersonLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActivityPersonLimit_owner_controller_key" ON "ActivityPersonLimit"("ownerDiscordUserId", "controllerDiscordUserId");
CREATE INDEX "ActivityPersonLimit_ownerDiscordUserId_idx" ON "ActivityPersonLimit"("ownerDiscordUserId");
ALTER TABLE "ActivityPersonLimit" ADD CONSTRAINT "ActivityPersonLimit_ownerDiscordUserId_fkey" FOREIGN KEY ("ownerDiscordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityPersonLimit" ADD CONSTRAINT "ActivityPersonLimit_controllerDiscordUserId_fkey" FOREIGN KEY ("controllerDiscordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
