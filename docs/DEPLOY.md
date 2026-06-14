# Deploying CruxAI

Three pieces: **Postgres** (managed), **API** (Cloud Run), **Web** (Vercel).
All have free tiers. ~20 minutes end to end.

---

## 1. Database — Neon (free)

1. Create a project at https://neon.tech
2. Copy the connection string (looks like
   `postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require`).
3. Keep it — it's your `DATABASE_URL`.

> Supabase or any Postgres works too.

---

## 2. API — Google Cloud Run

Prereqs: `gcloud` CLI, a GCP project with billing enabled.

```bash
cd api

gcloud run deploy cruxai-api \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 300 \
  --set-env-vars "DATABASE_URL=YOUR_NEON_URL,ANTHROPIC_API_KEY=sk-ant-...,CORS_ORIGIN=https://YOUR-VERCEL-APP.vercel.app"
```

- Cloud Run builds the `Dockerfile`, runs `prisma migrate deploy` on start, and listens on `$PORT`.
- Note the service URL it prints (e.g. `https://cruxai-api-xxxx.run.app`).
- `--timeout 300` gives summaries/quizzes room to finish.

> Don't have the Vercel URL yet? Deploy the web app first, or set
> `CORS_ORIGIN` after and redeploy with the same command.

---

## 3. Web — Vercel

1. Push this repo to GitHub.
2. On https://vercel.com → **New Project** → import the repo.
3. Set **Root Directory** to `web`.
4. Add env var: `NEXT_PUBLIC_API_URL = https://cruxai-api-xxxx.run.app`
5. Deploy. Every push redeploys.

---

## 4. Wire CORS

Make sure the API's `CORS_ORIGIN` matches your final Vercel domain
(e.g. `https://cruxai.vercel.app`). Update and redeploy the API if needed.

---

## Environment variables

### API
| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | from console.anthropic.com |
| `CORS_ORIGIN` | yes (prod) | comma-separated web origins |
| `PORT` | no | set automatically by Cloud Run |
| `MODEL_SUMMARY` / `MODEL_QUIZ` / `MODEL_GRADE` | no | model overrides |

### Web
| Var | Required | Notes |
|-----|----------|-------|
| `NEXT_PUBLIC_API_URL` | yes | API base URL |

---

## Migrations

The Docker image runs `prisma migrate deploy` automatically on start, so the
schema is applied on every deploy. To create a new migration during development:

```bash
cd api
npx prisma migrate dev --name your_change
```
