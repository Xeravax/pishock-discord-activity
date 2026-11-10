-- AlterTable
ALTER TABLE "DiscordUser" ADD COLUMN "commandQueueEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ActivityQueueStar" (
    "id" TEXT NOT NULL,
    "ownerDiscordUserId" TEXT NOT NULL,
    "starredDiscordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityQueueStar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityQueueStar_ownerDiscordUserId_idx" ON "ActivityQueueStar"("ownerDiscordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityQueueStar_ownerDiscordUserId_starredDiscordUserId_key" ON "ActivityQueueStar"("ownerDiscordUserId", "starredDiscordUserId");

-- AddForeignKey
ALTER TABLE "ActivityQueueStar" ADD CONSTRAINT "ActivityQueueStar_ownerDiscordUserId_fkey" FOREIGN KEY ("ownerDiscordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityQueueStar" ADD CONSTRAINT "ActivityQueueStar_starredDiscordUserId_fkey" FOREIGN KEY ("starredDiscordUserId") REFERENCES "DiscordUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
