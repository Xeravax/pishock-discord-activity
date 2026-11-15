-- AlterTable
ALTER TABLE "ActivityShare" ADD COLUMN "hubName" TEXT;

-- AlterTable
ALTER TABLE "CommandLog" ADD COLUMN "hubClientId" TEXT;
ALTER TABLE "CommandLog" ADD COLUMN "hubName" TEXT;
