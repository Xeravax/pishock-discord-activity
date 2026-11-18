-- Roulette: wearer opt-in for wheel spins (solo or room vote).
ALTER TABLE "DiscordUser" ADD COLUMN "rouletteAllowed" BOOLEAN NOT NULL DEFAULT false;
