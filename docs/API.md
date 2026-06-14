# CruxAI API

Base URL: `http://localhost:4000` (local) — no auth in the MVP.

All responses are JSON. Errors: `{ "statusCode": number, "message": string }`.

---

### `POST /documents`

Upload a PDF. Returns immediately; summarization runs in the background.

- **Body:** `multipart/form-data`, field `file` = the PDF (max 25 MB).
- **200:**
  ```json
  { "id": "clx...", "title": "My Book", "status": "PROCESSING", "createdAt": "..." }
  ```

Poll `GET /documents/:id` until `status` is `READY` or `FAILED`.

---

### `GET /documents/:id`

Fetch a document with its summary.

```json
{
  "id": "clx...",
  "title": "My Book",
  "status": "READY",
  "language": "en",
  "error": null,
  "summary": {
    "contentMd": "# ...markdown...",
    "keyPoints": ["...", "..."]
  },
  "quiz": { "id": "clq..." }  // null until a quiz is generated
}
```

`status`: `PROCESSING` · `READY` · `FAILED`.

---

### `POST /documents/:id/quiz`

Generate the quiz (idempotent — returns the existing one if already created).
Answers are **not** included.

```json
{
  "id": "clq...",
  "questions": [
    { "question": "...", "options": ["A", "B", "C", "D"] }
  ]
}
```

---

### `POST /quizzes/:quizId/attempts`

Submit answers; get a score and per-question feedback.

- **Body:**
  ```json
  { "answers": [0, 2, 1, 3, 0] }
  ```
  One option index per question; use `-1` for unanswered.
- **200:**
  ```json
  {
    "id": "cla...",
    "score": 4,
    "total": 5,
    "feedback": [
      {
        "index": 0,
        "correct": true,
        "correctIndex": 0,
        "chosenIndex": 0,
        "explanation": "..."
      }
    ]
  }
  ```

The score is computed server-side; feedback explanations come from Claude.
