-- Session recaps: per-session summary, optional DM, read state.
ALTER TABLE "DiscordUser" ADD COLUMN "recapDmEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ActivitySession" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "summary" JSONB,
    "dmStatus" TEXT NOT NULL DEFAULT 'pending',
    "seenAt" TIMESTAMP(3),
    CONSTRAINT "ActivitySession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivitySession_discordUserId_startedAt_idx" ON "ActivitySession"("discordUserId", "startedAt");
CREATE INDEX "ActivitySession_endedAt_idx" ON "ActivitySession"("endedAt");
ALTER TABLE "ActivitySession" ADD CONSTRAINT "ActivitySession_discordUserId_fkey" FOREIGN KEY ("discordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
