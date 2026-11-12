-- One PiShock account / API key can be linked to only one Discord user.
-- Keep the newest row when the same account was linked twice.
DELETE FROM "PiShockSession" AS older
USING "PiShockSession" AS newer
WHERE older."pishockUserId" = newer."pishockUserId"
  AND older."discordUserId" <> newer."discordUserId"
  AND (
    older."updatedAt" < newer."updatedAt"
    OR (older."updatedAt" = newer."updatedAt" AND older."id" < newer."id")
  );

ALTER TABLE "PiShockSession" ADD COLUMN "apiKeyHash" TEXT;

CREATE UNIQUE INDEX "PiShockSession_pishockUserId_key" ON "PiShockSession"("pishockUserId");
CREATE UNIQUE INDEX "PiShockSession_apiKeyHash_key" ON "PiShockSession"("apiKeyHash");
