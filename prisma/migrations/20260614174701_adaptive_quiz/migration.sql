-- DropIndex
DROP INDEX "Quiz_documentId_key";

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "adaptive" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Attempt_userId_createdAt_idx" ON "Attempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Quiz_documentId_createdAt_idx" ON "Quiz"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
