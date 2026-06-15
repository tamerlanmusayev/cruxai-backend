-- Add Google profile fields to User (nullable; anonymous users keep them null).
ALTER TABLE "User" ADD COLUMN "name" TEXT;
ALTER TABLE "User" ADD COLUMN "picture" TEXT;
