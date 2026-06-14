-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "score" INTEGER,
    "weakReport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptEdge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,

    CONSTRAINT "ConceptEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConcept" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "seen" INTEGER NOT NULL DEFAULT 0,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConcept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exam_userId_createdAt_idx" ON "Exam"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Concept_documentId_idx" ON "Concept"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConceptEdge_fromId_toId_relation_key" ON "ConceptEdge"("fromId", "toId", "relation");

-- CreateIndex
CREATE INDEX "UserConcept_userId_mastery_idx" ON "UserConcept"("userId", "mastery");

-- CreateIndex
CREATE UNIQUE INDEX "UserConcept_userId_conceptId_key" ON "UserConcept"("userId", "conceptId");

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptEdge" ADD CONSTRAINT "ConceptEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptEdge" ADD CONSTRAINT "ConceptEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConcept" ADD CONSTRAINT "UserConcept_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConcept" ADD CONSTRAINT "UserConcept_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
