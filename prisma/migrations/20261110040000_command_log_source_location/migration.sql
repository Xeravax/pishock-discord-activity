-- AlterTable
ALTER TABLE "CommandLog" ADD COLUMN "executorLabel" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'discord';
ALTER TABLE "CommandLog" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "guildId" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "channelId" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "locationKind" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "locationName" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "locationIconUrl" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "externalLogKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CommandLog_externalLogKey_key" ON "CommandLog"("externalLogKey");
CREATE INDEX "CommandLog_createdAt_idx" ON "CommandLog"("createdAt");
CREATE INDEX "CommandLog_source_createdAt_idx" ON "CommandLog"("source", "createdAt");
