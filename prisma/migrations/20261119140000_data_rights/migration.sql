-- Data rights (GDPR/AVG): per-user log retention and self-service delete / anonymise requests.
ALTER TABLE "DiscordUser" ADD COLUMN "logRetentionDays" INTEGER DEFAULT 365;

CREATE TABLE "DataDeletionRequest" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT,
    "mode" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executeAfter" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "DataDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataDeletionRequest_discordUserId_idx" ON "DataDeletionRequest"("discordUserId");
CREATE INDEX "DataDeletionRequest_executeAfter_idx" ON "DataDeletionRequest"("executeAfter");
