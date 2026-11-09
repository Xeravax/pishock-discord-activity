-- CreateTable
CREATE TABLE "ActivityShare" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "shockerId" INTEGER NOT NULL,
    "shockerName" TEXT NOT NULL,
    "hubClientId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "maxIntensity" INTEGER NOT NULL DEFAULT 100,
    "maxDurationMs" INTEGER NOT NULL DEFAULT 15000,
    "canShock" BOOLEAN NOT NULL DEFAULT true,
    "canVibrate" BOOLEAN NOT NULL DEFAULT true,
    "canBeep" BOOLEAN NOT NULL DEFAULT true,
    "canHold" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityBan" (
    "id" TEXT NOT NULL,
    "ownerDiscordUserId" TEXT NOT NULL,
    "bannedDiscordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityBan_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CommandLog" ADD COLUMN "executorDiscordUserId" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "targetDiscordUserId" TEXT;

-- CreateIndex
CREATE INDEX "ActivityShare_discordUserId_enabled_paused_idx" ON "ActivityShare"("discordUserId", "enabled", "paused");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityShare_discordUserId_shockerId_key" ON "ActivityShare"("discordUserId", "shockerId");

-- CreateIndex
CREATE INDEX "ActivityBan_ownerDiscordUserId_idx" ON "ActivityBan"("ownerDiscordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityBan_ownerDiscordUserId_bannedDiscordUserId_key" ON "ActivityBan"("ownerDiscordUserId", "bannedDiscordUserId");

-- CreateIndex
CREATE INDEX "CommandLog_targetDiscordUserId_createdAt_idx" ON "CommandLog"("targetDiscordUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityShare" ADD CONSTRAINT "ActivityShare_discordUserId_fkey" FOREIGN KEY ("discordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBan" ADD CONSTRAINT "ActivityBan_ownerDiscordUserId_fkey" FOREIGN KEY ("ownerDiscordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBan" ADD CONSTRAINT "ActivityBan_bannedDiscordUserId_fkey" FOREIGN KEY ("bannedDiscordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
