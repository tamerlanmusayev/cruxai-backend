-- Flag curated public sample documents (home-page examples).
ALTER TABLE "Document" ADD COLUMN "isExample" BOOLEAN NOT NULL DEFAULT false;
