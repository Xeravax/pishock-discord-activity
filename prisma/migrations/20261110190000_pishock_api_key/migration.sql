-- Session tokens cannot be converted; force re-link with a named API key.
DELETE FROM "PiShockSession";

ALTER TABLE "PiShockSession" ADD COLUMN "pishockUsername" TEXT NOT NULL;
ALTER TABLE "PiShockSession" ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "PiShockSession" ADD COLUMN "apiKeyId" INTEGER;
