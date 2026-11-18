-- Admin panel: app-wide bans (with reason + history), admin audit trail, app settings.
CREATE TABLE "GlobalBan" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "bannedByDiscordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "liftedByDiscordUserId" TEXT,
    "liftReason" TEXT,
    CONSTRAINT "GlobalBan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GlobalBan_discordUserId_createdAt_idx" ON "GlobalBan"("discordUserId", "createdAt");
CREATE INDEX "GlobalBan_createdAt_idx" ON "GlobalBan"("createdAt");

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminDiscordUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetDiscordUserId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
CREATE INDEX "AdminAuditLog_targetDiscordUserId_createdAt_idx" ON "AdminAuditLog"("targetDiscordUserId", "createdAt");

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByDiscordUserId" TEXT,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
