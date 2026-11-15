-- Warning vibe actually sent before a shock or hold (small, mid, long).
ALTER TABLE "CommandLog" ADD COLUMN "warningLevel" TEXT;
