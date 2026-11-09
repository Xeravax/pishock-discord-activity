-- AlterTable
ALTER TABLE "DiscordUser" ADD COLUMN "emergencyStopShockerIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
