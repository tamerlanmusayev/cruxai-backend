# CruxAI — Backend (API)

NestJS + Prisma + PostgreSQL API for **CruxAI**, an AI learning platform that turns
any book or textbook into a citation-grounded summary, flashcards, an adaptive
quiz, a knowledge graph, exams and audio. Built by
[Tamerlan Musayev](https://github.com/tamerlanmusayev).

> Frontend lives in a separate repo: **cruxai-frontend**.

---

## Stack
- **NestJS 10** (TypeScript), **Prisma 6**, **PostgreSQL** (pgvector-ready)
- **Claude API** (Opus for summary/quiz/graph, Sonnet for grading)
- **socket.io** for live presence, **BullMQ-ready** background processing
- Helmet, rate limiting (`@nestjs/throttler`), optional reCAPTCHA v3, JWT auth

## Quick start
```bash
cp .env.example .env          # fill ANTHROPIC_API_KEY (+ DATABASE_URL)
docker compose up -d          # or use your own Postgres (host port 5433)
npm install
npx prisma migrate dev
npm run start:dev             # http://localhost:4000
```

## Modules
```
src/
  auth/         anonymous JWT sessions + guard
  documents/    upload, multi-format extract, chunking, library
  summary (ai/) citation-grounded summaries
  quiz/         adaptive quiz generation
  attempts/     grading + mastery updates
  flashcards/   generation + SM-2 spaced repetition
  concepts/     knowledge graph extraction
  exams/        timed exams + weak-area report
  synthesis/    multi-book consensus + differences
  progress/     per-concept mastery (UserConcept)
  audio/        premium TTS (ElevenLabs) with browser fallback
  stats/        public aggregate metrics + socket presence
  security/     reCAPTCHA guard
  ai/           Claude wrapper (structured tool-use)
```

## API reference
See [docs/API.md](docs/API.md). Architecture & roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Environment

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | console.anthropic.com |
| `JWT_SECRET` | prod | required in production (boot fails without it) |
| `CORS_ORIGIN` | prod | comma-separated web origins |
| `PORT` | no | default 4000 (Cloud Run sets it) |
| `MODEL_SUMMARY` / `MODEL_QUIZ` / `MODEL_GRADE` | no | model overrides |
| `RECAPTCHA_SECRET` / `RECAPTCHA_MIN_SCORE` / `RECAPTCHA_VERIFY_URL` | no | reCAPTCHA v3 (blank = off in dev) |
| `AUDIO_PROVIDER` | no | `""` (browser TTS) or `elevenlabs` |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` / `ELEVENLABS_API_URL` / `ELEVENLABS_MODEL` | no | premium audio |
| `DEMO_MODE` | no | **demo only** — simulated stats for local presentations; keep `false` in prod |

## Deploy
See [docs/DEPLOY.md](docs/DEPLOY.md). TL;DR — Google Cloud Run:
```bash
gcloud run deploy cruxai-api --source . --region europe-west1 \
  --allow-unauthenticated --memory 1Gi --timeout 300 \
  --set-env-vars "DATABASE_URL=...,ANTHROPIC_API_KEY=...,JWT_SECRET=...,CORS_ORIGIN=https://cruxai.az"
```
The image runs `prisma migrate deploy` on start.

## License
MIT — see [LICENSE](LICENSE).
