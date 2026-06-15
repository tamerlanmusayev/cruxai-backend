-- New status: a document is QUEUED until the background worker picks it up.
ALTER TYPE "DocStatus" ADD VALUE IF NOT EXISTS 'QUEUED';

-- Uploaded object keys the worker fetches from storage: [{ key, name }].
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "sources" JSONB;

-- `text` is now filled by the worker after ingest, so it defaults to empty.
ALTER TABLE "Document" ALTER COLUMN "text" SET DEFAULT '';
