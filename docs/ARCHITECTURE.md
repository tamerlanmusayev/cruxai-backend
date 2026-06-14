# CruxAI — AI Learning OS Architecture

Transforming CruxAI from a summarizer into an **AI Learning OS**: any textbook →
personalized learning path, memory-retention system, adaptive testing, knowledge
graph, and exam readiness — with **citation-grounded** AI and **measurable
learning improvement** (the core "educational AI breakthrough" narrative).

No full rewrite. We extend the existing NestJS + Prisma + Postgres + Claude stack
with **pgvector** (RAG/citations), **BullMQ + Redis** (background jobs), and a
**TTS provider** (audio). Everything stays modular and event-driven.

---

## 1. System architecture (text diagram)

```
                          ┌─────────────── Next.js web (Vercel) ───────────────┐
                          │  upload · notebook · flashcards · graph · exam · audio │
                          └───────────────────────┬───────────────────────────┘
                                                   │ HTTPS (JWT)
                          ┌────────────────────────▼───────────────────────────┐
                          │                  NestJS API (Cloud Run)             │
                          │  auth · documents · summary · concepts · flashcards │
                          │  quiz · exams · progress · synthesis · audio · stats│
                          └───┬───────────────┬───────────────┬────────────────┘
                              │ enqueue       │ read/write    │ call
                  ┌───────────▼──────┐  ┌─────▼─────────┐  ┌──▼───────────────┐
                  │ Redis + BullMQ   │  │  PostgreSQL   │  │  External AI      │
                  │ job queues       │  │  + pgvector   │  │  Claude (reason)  │
                  └───────┬──────────┘  └───────────────┘  │  Voyage (embed)   │
                          │ workers (same image, WORKER=1)  │  TTS (audio)      │
                  ┌───────▼───────────────────────────┐    └──────────────────┘
                  │ processors: ingest → embed →       │
                  │ summarize → extract-concepts →     │    ┌──────────────────┐
                  │ build-graph → gen-flashcards →     │    │ Object storage    │
                  │ gen-audio                          │    │ (GCS): files,audio│
                  └────────────────────────────────────┘   └──────────────────┘
```

**Why these additions**
- **pgvector** — citations + RAG live *inside* Postgres. No new datastore, scales fine.
- **BullMQ/Redis** — long AI work (embedding, graph, audio) must not block requests.
- **Voyage embeddings** — Anthropic's recommended embedding partner (Claude has no embeddings API).
- **Event-driven** — each job completion enqueues the next; partial results stream to the UI.

---

## 2. Database schema changes (Prisma)

```prisma
// --- existing models extended ---

model User {
  id            String     @id @default(cuid())
  email         String?    @unique          // null = anonymous, upgradeable
  anonId        String?    @unique           // device/session id pre-signup
  createdAt     DateTime   @default(now())
  documents     Document[]
  reviews       FlashcardReview[]
  attempts      Attempt[]
  masteries     UserConcept[]
  exams         Exam[]
  paths         LearningPath[]
}

model Document {
  id          String     @id @default(cuid())
  userId      String
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  title       String
  fileUrl     String?                       // GCS object (for re-processing)
  language    String?
  status      DocStatus  @default(PROCESSING)
  error       String?
  chunks      Chunk[]
  summary     Summary?
  concepts    Concept[]
  flashcards  Flashcard[]
  quiz        Quiz?
  audioTracks AudioTrack[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

// --- new: retrieval & citations ---

model Chunk {
  id         String   @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  ordinal    Int                              // order in document
  page       Int?                             // source page (citation)
  section    String?                          // source heading (citation)
  text       String
  embedding  Unsupported("vector(1024)")?     // pgvector; queried via raw SQL
  createdAt  DateTime @default(now())
  @@index([documentId, ordinal])
}

model Summary {
  id         String   @id @default(cuid())
  documentId String   @unique
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  contentMd  String
  keyPoints  Json
  citations  Json     // [{ claimId, chunkId, page, section }]
  createdAt  DateTime @default(now())
}

// --- new: knowledge graph ---

model Concept {
  id          String        @id @default(cuid())
  documentId  String
  document    Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  name        String
  summary     String                          // 1–2 sentence definition
  citations   Json                            // grounding chunks
  difficulty  Difficulty    @default(MEDIUM)
  flashcards  Flashcard[]
  masteries   UserConcept[]
  questions   Question[]
  outEdges    ConceptEdge[] @relation("from")
  inEdges     ConceptEdge[] @relation("to")
  @@index([documentId])
}

model ConceptEdge {
  id        String  @id @default(cuid())
  fromId    String
  toId      String
  from      Concept @relation("from", fields: [fromId], references: [id], onDelete: Cascade)
  to        Concept @relation("to",   fields: [toId],   references: [id], onDelete: Cascade)
  relation  String                            // "prerequisite" | "part-of" | "related"
  weight    Float   @default(1)
  @@unique([fromId, toId, relation])
}

// --- new: flashcards + SRS (SM-2) ---

model Flashcard {
  id         String            @id @default(cuid())
  documentId String
  conceptId  String?
  document   Document          @relation(fields: [documentId], references: [id], onDelete: Cascade)
  concept    Concept?          @relation(fields: [conceptId], references: [id])
  front      String
  back       String
  difficulty Difficulty        @default(MEDIUM)
  citations  Json
  reviews    FlashcardReview[]
}

model FlashcardReview {
  id           String    @id @default(cuid())
  userId       String
  flashcardId  String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  flashcard    Flashcard @relation(fields: [flashcardId], references: [id], onDelete: Cascade)
  // SM-2 state
  easeFactor   Float     @default(2.5)
  intervalDays Int       @default(0)
  repetitions  Int       @default(0)
  dueAt        DateTime  @default(now())
  lastGrade    Int?                            // 0–5 recall quality
  @@unique([userId, flashcardId])
  @@index([userId, dueAt])
}

// --- new: adaptive testing & progress ---

model Quiz {
  id         String     @id @default(cuid())
  documentId String     @unique
  document   Document   @relation(fields: [documentId], references: [id], onDelete: Cascade)
  questions  Question[]
}

model Question {
  id          String   @id @default(cuid())
  quizId      String?
  conceptId   String?
  quiz        Quiz?    @relation(fields: [quizId], references: [id], onDelete: Cascade)
  concept     Concept? @relation(fields: [conceptId], references: [id])
  stem        String
  options     Json     // string[4]
  correct     Int
  explanation String
  difficulty  Difficulty @default(MEDIUM)
  citations   Json
}

model Attempt {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  quizId    String?
  examId    String?
  answers   Json     // [{ questionId, chosen, correct, conceptId }]
  score     Int
  total     Int
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}

model UserConcept {            // per-user mastery (the adaptive core)
  id         String   @id @default(cuid())
  userId     String
  conceptId  String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  concept    Concept  @relation(fields: [conceptId], references: [id], onDelete: Cascade)
  mastery    Float    @default(0)   // 0..1, EWMA of correctness
  seen       Int      @default(0)
  correct    Int      @default(0)
  updatedAt  DateTime @updatedAt
  @@unique([userId, conceptId])
  @@index([userId, mastery])
}

// --- new: exams & learning paths ---

model Exam {
  id          String   @id @default(cuid())
  userId      String
  documentId  String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  durationSec Int
  questionIds Json
  predicted   Float?   // predicted score before taking
  score       Int?
  weakReport  Json?    // [{ conceptId, mastery }]
  createdAt   DateTime @default(now())
}

model LearningPath {
  id         String   @id @default(cuid())
  userId     String
  documentId String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  steps      Json     // ordered [{ conceptId, action: "learn|drill|review", reason }]
  updatedAt  DateTime @updatedAt
}

model AudioTrack {
  id         String   @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  scope      String   // "full" | "chapter:<n>" | "concept:<id>"
  url        String   // GCS signed-url base
  voice      String
  createdAt  DateTime @default(now())
}

enum DocStatus  { PROCESSING READY FAILED }
enum Difficulty { EASY MEDIUM HARD }
```

pgvector setup: `CREATE EXTENSION vector;` in a migration; similarity via raw SQL
(`embedding <=> $1` cosine distance) since Prisma can't type the operator.

---

## 3. Backend module structure (NestJS)

```
src/
  auth/            JWT, anonymous→account upgrade, guards
  ingestion/       upload, extract (pdf/docx/txt/md), chunking, page mapping
  embeddings/      Voyage client, pgvector upsert + similarity search (RAG)
  documents/       CRUD, status, library
  summary/         citation-grounded summary (RAG over chunks)
  concepts/        concept + relationship extraction → knowledge graph
  graph/           graph read API (nodes/edges) for visualization
  flashcards/      generation + SRS scheduling (SM-2)
  quiz/            adaptive question selection + grading
  exams/           timed exam assembly, scoring, prediction
  progress/        UserConcept mastery updates, learning-path generation
  synthesis/       multi-book consensus + difference analysis (RAG across docs)
  audio/           TTS jobs, chapter playback, signed URLs
  jobs/            BullMQ queues + processors (worker mode)
  ai/              Claude wrapper (existing, structured tool-use)
  stats/           public aggregate metrics + learning-improvement KPIs
  prisma/          PrismaService (existing)
```

Run mode: same container; `WORKER=1` boots BullMQ processors instead of the HTTP
server, so API and workers scale independently on Cloud Run.

---

## 4. AI pipeline (text → learning system)

```
upload
  → ingest job:   extract text + page/section map → chunk (~800 tokens, overlap)
  → embed job:    Voyage embeddings → store vectors in Chunk (pgvector)
  → summarize:    RAG top-k chunks → Claude → summary + CITATIONS (chunkId/page)
  → concepts:     map-reduce Claude over chunks → Concept[] + ConceptEdge[]
  → graph:        normalize/dedupe concepts → knowledge graph
  → flashcards:   per concept → Claude → front/back + difficulty + citations
  → questions:    per concept → Claude → MCQ bank + citations
  → audio (opt):  summary/chapter text → TTS → GCS → AudioTrack
```

**Citation rule (enforced):** every summary claim, explanation, flashcard, and
question is generated **only** from retrieved chunks passed in-context, and must
emit the `chunkId` it came from. A post-step validates each citation resolves to
a real chunk; unsupported claims are dropped. This is what makes output trustworthy
(and defensible to journalists/educators).

**Adaptive loop (runtime):**
```
answer → update UserConcept mastery (EWMA) → recompute weak concepts
       → next quiz item: weighted sampling toward low-mastery concepts
       → learning path regenerated (learn → drill → review order)
```

**Multi-book synthesis:** retrieve top-k chunks per book for a query → Claude
produces a consensus explanation + a per-source difference table (with citations).

---

## 5. API endpoints

```
Auth
  POST   /auth/anonymous            issue anon token
  POST   /auth/register             email upgrade
  POST   /auth/login

Documents
  POST   /documents                 upload (multi-file) → starts pipeline
  GET    /documents                 user library
  GET    /documents/:id             status + summary + citations
  GET    /documents/:id/audio       audio tracks

Knowledge graph
  GET    /documents/:id/graph       { nodes, edges } for visualization
  GET    /concepts/:id              concept detail + citations + neighbors

Flashcards + SRS
  GET    /flashcards/due            today's review queue (per user)
  POST   /flashcards/:id/review     { grade 0-5 } → SM-2 reschedule
  POST   /documents/:id/flashcards  (re)generate

Adaptive quiz
  POST   /documents/:id/quiz        adaptive set targeting weak concepts
  POST   /quizzes/:id/attempts      grade + mastery update + explanations

Exams
  POST   /documents/:id/exams       build timed exam + score prediction
  POST   /exams/:id/submit          score + weak-area report

Progress / path
  GET    /progress                  mastery per concept, retention curve
  GET    /documents/:id/path        personalized learning path

Synthesis
  POST   /synthesis                 { documentIds, query } → consensus + diffs

Stats
  GET    /stats                     public KPIs incl. learning-improvement
```

---

## 6. Background jobs / queues (BullMQ)

| Queue | Trigger | Work | Next |
|-------|---------|------|------|
| `ingest` | upload | extract + chunk + page map | → embed |
| `embed` | ingest done | Voyage embeddings → pgvector | → summarize, concepts |
| `summarize` | embed done | RAG → Claude summary + citations | — |
| `concepts` | embed done | extract concepts + edges | → graph, flashcards, questions |
| `graph` | concepts done | dedupe/normalize graph | — |
| `flashcards` | concepts done | generate cards per concept | — |
| `questions` | concepts done | generate MCQ bank | — |
| `audio` | on request | TTS → GCS | — |

Cross-cutting: retries with backoff, idempotency keys (documentId+stage),
per-job cost/latency logging, dead-letter queue. UI subscribes to document status
and renders each artifact as its job completes (progressive reveal).

---

## 7. Core data models (recap)

- **Concept** — node: name, definition, difficulty, citations; edges via `ConceptEdge` (prerequisite/part-of/related).
- **Flashcard + FlashcardReview** — content + per-user SM-2 state (easeFactor, interval, repetitions, dueAt).
- **UserConcept** — per-user mastery (0–1 EWMA), seen/correct counts → drives adaptivity, paths, exam prediction.
- **Knowledge graph** — `Concept` (nodes) + `ConceptEdge` (edges), grounded in `Chunk` citations.

**SM-2 (spaced repetition)**: on review grade `q` (0–5); if `q<3` reset reps,
interval=1; else interval grows by `easeFactor`; `EF' = EF + (0.1 − (5−q)(0.08 + (5−q)0.02))`, floored at 1.3. `dueAt = now + interval days`.

---

## 8. Implementation plan (MVP → V1 → V2)

**MVP (now → ~2 weeks) — "real learning, not summaries"**
1. `auth` (anonymous tokens + optional email) so progress is per-user.
2. `ingestion` chunking + page mapping; `embeddings` (Voyage) + pgvector.
3. Citation-grounded summary (rework existing summary over RAG).
4. `flashcards` + SM-2 review queue (`/flashcards/due`, `/review`).
5. Adaptive quiz v1 (weighted by `UserConcept` mastery) + mastery updates.
6. Premium TTS (chapter audio) replacing browser speech.
7. BullMQ/Redis + worker mode (move heavy work off the request path).

**V1 (~1 month) — "the OS"**
8. `concepts` extraction + `graph` API + frontend graph visualization.
9. `exams` (timed simulation, question bank, score prediction, weak report).
10. `progress` dashboard (mastery, retention curve) + learning path.
11. `synthesis` multi-book consensus + differences.

**V2 (~2–3 months) — "breakthrough + scale"**
12. Learning-improvement analytics: pre/post mastery deltas, retention curves,
    cohort outcomes — the publishable "students improved X%" claim.
13. Scale: queue worker autoscaling, Redis-backed rate limits, caching, read replicas.
14. Curriculum alignment (AZ/KZ/GE textbooks), mobile app, partnerships.

**Narrative for press/Series A:** CruxAI doesn't summarize — it *measurably
improves retention and exam readiness*, with citation-grounded, transparent AI,
built first for underserved CIS students. The metrics page proves it.
```
