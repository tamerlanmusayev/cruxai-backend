-- Persisted daily AI-token counters (per user + a '__global__' row).
CREATE TABLE "UsageCounter" (
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("userId", "day")
);
