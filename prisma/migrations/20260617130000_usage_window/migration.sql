-- Switch from fixed-UTC-day counters to a rolling 24h window per user.
DROP TABLE IF EXISTS "UsageCounter";
CREATE TABLE "UsageWindow" (
  "userId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "UsageWindow_pkey" PRIMARY KEY ("userId")
);
