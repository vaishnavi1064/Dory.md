# Dory.md — Full Repository Audit (Agent 1)

**Date:** 2026-06-01
**Auditor stance:** Adversarial. Code is assumed to be lying until verified against the source and a runnable baseline.
**Scope:** Entire repository (`backend/`, `frontend/`, configs, tests, scripts).

---

## 0. Verified baseline (what actually runs today)

| Check | Command | Result | Status |
|---|---|---|---|
| Backend unit tests | `pytest tests/ -v` (venv, test-dep subset) | **27 passed** in 11.65s | VERIFIED |
| Frontend typecheck | `tsc --noEmit` | exit 0 | VERIFIED |
| Frontend prod build | `vite build` | exit 0, built in 4.74s | VERIFIED |
| Frontend lint | `eslint . --max-warnings 0` | **FAILS — no `eslint.config.js`** (ESLint 9 needs flat config) | VERIFIED |
| Full backend install | `pip install -r requirements.txt` | **Will FAIL on Python 3.14**: `torch==2.5.1+cpu` has no cp314 wheel | VERIFIED (env: Python 3.14.5) |

**Evidence**
- Tests: ran in `/home/nikhil/Dory.md/backend/.venv` (Python 3.14.5, pytest 9.0.3). Output: `27 passed, 2 warnings`. The README claims "17 pytest cases" ([ReadMe.md:39](ReadMe.md)) — **stale**, there are 27.
- Lint: `ESLint couldn't find an eslint.config.(js|mjs|cjs) file.` No `.eslintrc*` or `eslint.config.*` exists in the repo (`find` returned nothing). `package.json` pins `eslint ^9.9.1`; lockfile resolves `9.39.4` ([frontend/package.json:10,33](frontend/package.json)).
- Node/npm are **not installed** on this machine; a local Node 22.22.3 was downloaded to validate the frontend. This is an environment fact, not a repo defect, but it means CI must provision Node.

**Honest limitation:** Live end-to-end behavior (uvicorn serving real requests with ChromaDB + sentence-transformers + a Groq key, and the SPA hitting it in a browser) was **NOT** executed. The heavy ML stack (`torch`, `sentence-transformers`) was deliberately not installed (tests skip warm-up via `DORY_SKIP_WARMUP=1`). All findings below are from static reading + the unit-test baseline. Anything requiring a running server is marked **UNVERIFIED (runtime)**.

---

## 1. Severity legend

- **P0 — Blocker / correctness or security defect** that affects real users or data.
- **P1 — Production-readiness gap** that must be closed before selling.
- **P2 — Quality / maintainability / polish.**

Each finding carries a status: VERIFIED (read in code + reasoned), PARTIALLY VERIFIED, or UNVERIFIED (runtime).

---

## 2. P0 — Correctness & data-integrity defects

### P0-1 — Editing a chunk leaves a stale vector embedding (silent search corruption) — VERIFIED
`PUT /api/chunks/{id}` updates the SQLite `content` but never recomputes the embedding or updates ChromaDB.
- Evidence: [backend/routers/chunks.py:80-85](backend/routers/chunks.py#L80-L85) calls only `update_chunk_content(...)`. `grep` confirms `chunks.py` imports no embedding/`add_chunks` symbol. The vector for that chunk still reflects the **old** text.
- Impact: After any edit, semantic search ranks the chunk by its pre-edit meaning. The note's content and its searchable representation silently diverge. For a "knowledge that resurfaces what you're forgetting" product, this is a core-promise defect.

### P0-2 — `complete_quiz_session` is dead; quiz sessions are never completed — VERIFIED
- Evidence: `complete_quiz_session` is defined ([backend/database/db.py:397](backend/database/db.py#L397)) but `grep` finds **zero callers**. `submit_quiz` ([backend/routers/quiz.py:189-234](backend/routers/quiz.py#L189-L234)) computes a score and returns it but never persists `completed_at`/`correct_count`. The `quiz_sessions` table accumulates rows that are all "started, never finished."
- Impact: No durable quiz history despite a `quiz_sessions` table and a commit titled "quiz history fix". The feature is half-wired.

### P0-3 — `submit_quiz` trusts a process-local in-memory session map — VERIFIED
- Evidence: `_session_store: dict[...] = {}` ([backend/routers/quiz.py:26](backend/routers/quiz.py#L26)). Correct answers live only in this process dict. On restart, multi-worker deploy, or after the quiz/start hits a different worker than quiz/submit, `session_map` is empty → every answer scores against `correct_index=0` and `chunk_id=qid` ([quiz.py:200-203](backend/routers/quiz.py#L200-L203)).
- Impact: Wrong scores and broken stability updates under any non-single-process deployment (e.g. `uvicorn --workers >1`, gunicorn, autoscaling). Hidden because it "works on my machine" with one worker.

### P0-4 — `/api/quiz/answer` is fully client-trusted — VERIFIED
- Evidence: `submit_answer` ([quiz.py:171-186](backend/routers/quiz.py#L171-L186)) takes `correct_index` **from the request body** and compares `selected_index == correct_index`. The client supplies both sides of the comparison and the reward (`update_chunk_access_by(delta=2)`).
- Impact: Any client can inflate `access_count` (and thus retention) for arbitrary owned chunks by POSTing `selected_index == correct_index`. Not a cross-user breach (ownership is enforced), but it makes the "memory strength" metric trivially forgeable. The `/submit` path is server-authoritative; `/answer` is not. Two parallel scoring paths with different trust models is itself a smell.

### P0-5 — Refresh-token table grows forever — VERIFIED
- Evidence: `purge_expired_refresh_tokens` defined ([db.py:446](backend/database/db.py#L446)), **zero callers** (`grep`). Every login/refresh inserts a row ([auth.py:60](backend/routers/auth.py#L60)); rotation only sets `revoked_at`, never deletes. Nothing ever purges.
- Impact: Unbounded growth of `refresh_tokens` (30-day TTL but rows persist past expiry). Slow leak; over months/years the table and its index bloat.

---

## 3. P1 — Security & production-readiness

### P1-1 — No structured logging / observability anywhere — VERIFIED
- Evidence: `grep -rn "logging\|logger"` over `backend/` returns **nothing**. No request logging, no error logging, no audit trail. `except Exception: pass` swallows failures silently in several spots ([chunks.py:95](backend/routers/chunks.py#L95), [category_service.py:37](backend/services/category_service.py#L37)).
- Impact: In production you are blind. A failing classifier, a Chroma write error, or a 500 leaves no trace.

### P1-2 — No rate limiting on auth or LLM endpoints — VERIFIED
- Evidence: No `slowapi`/limiter/middleware (`grep`). `/auth/login` and `/auth/register` are unthrottled (credential stuffing / brute force). `/ai/*` proxy a paid LLM with no per-user quota — the test file itself warns these "would let anonymous users burn the team's Groq budget" ([tests/test_ai_auth.py:4](backend/tests/test_ai_auth.py#L4)) yet there is no spend cap even for authenticated users.

### P1-3 — Permissive CORS for a credentialed API — VERIFIED (config), UNVERIFIED (exploitability)
- Evidence: default `CORS_ORIGIN_REGEX` ([main.py:29-32](backend/main.py#L29-L32)) allows `http(s)://<any 4-octet IP>` and **any** `*.vercel.app`, with `allow_credentials=True`. Any attacker's `*.vercel.app` preview can call the API with credentials.
- Mitigating fact: tokens are sent via the `Authorization` header from `localStorage`, not cookies, so the classic CORS+cookie CSRF vector does not directly apply. Still, the regex is far wider than a production allow-list should be and should be pinned to known origins.

### P1-4 — Tokens in `localStorage`; demo "offline" bypass fabricates a session — VERIFIED
- Evidence: access + refresh tokens stored in `localStorage` ([frontend/src/lib/tokens.ts:15-20](frontend/src/lib/tokens.ts#L15-L20)) — readable by any XSS. Combined with three `dangerouslySetInnerHTML` sinks (P1-5), XSS → full token theft.
- Evidence: `AuthContext.login` ([frontend/src/contexts/AuthContext.tsx:52-76](frontend/src/contexts/AuthContext.tsx#L52-L76)) — if the backend is unreachable **or returns non-OK**, and the creds are `demo@dory.md/demo123`, it calls `adoptLocalDemo` and returns `true` with **no token**. The user appears "logged in" but every subsequent API call 401s. Confusing fake-success state.

### P1-5 — Three unsanitized `dangerouslySetInnerHTML` sinks — VERIFIED
- Evidence:
  - [NoteEditorPage.tsx:337](frontend/src/pages/NoteEditorPage.tsx#L337) renders `marked.parse(...)` output (user-authored markdown) with no sanitizer.
  - [SearchPage.tsx:126](frontend/src/pages/SearchPage.tsx#L126) and [ChunkCard.tsx:119](frontend/src/components/chunks/ChunkCard.tsx#L119) render `highlight` HTML.
- Impact: `marked` does not sanitize by default. A note containing `<img src=x onerror=...>` executes on render → steals the `localStorage` tokens from P1-4. No DOMPurify dependency present (`grep`). This is a realistic stored-XSS chain.

### P1-6 — Schema lives in two places; canonical schema is incomplete — VERIFIED
- Evidence: `schema.sql` ([backend/database/schema.sql](backend/database/schema.sql)) defines `users(id,email,created_at)` and `chunks(... no fsrs_*, no folder)`. The columns `users.name`, `users.password_hash`, `chunks.folder`, and all `fsrs_*` columns exist **only** via imperative `ALTER TABLE` in `_migrate` ([db.py:32-60](backend/database/db.py#L32-L60)).
- Impact: There is no single source of truth for the schema, no migration framework (Alembic), and no down-migrations. A reviewer reading `schema.sql` gets a wrong picture. Covered in depth in `DATABASE_REVIEW.md`.

### P1-7 — `JWT_SECRET` missing in prod fails *per-request*, not at boot — VERIFIED
- Evidence: `_get_secret` raises `RuntimeError` only when called ([deps.py:7-19](backend/routers/deps.py#L7-L19)). With `DORY_ENV != dev` and no secret, the app **starts fine** and every auth request 500s.
- Impact: A misconfigured deploy looks healthy (`/` returns ok, lifespan succeeds) but is 100% broken for auth. Should fail fast at startup.

### P1-8 — No `/health`-style liveness endpoint for infra — VERIFIED
- Evidence: `GET /` returns `{"status":"ok"}` ([main.py:55-57](backend/main.py#L55-L57)) but `GET /api/health` is the **Time Machine** retention projection ([routers/health.py](backend/routers/health.py)) — auth-required and semantically unrelated to liveness/readiness. There is no DB/Chroma readiness probe.

---

## 4. P1 — API correctness & consistency

### P4-1 — Category taxonomy is inconsistent across three layers — VERIFIED
- Classifier emits: `["Computer Science","Design","Personal","Mathematics","Research","Other"]` ([category_service.py:13](backend/services/category_service.py#L13)).
- Seeder writes: `"AI/ML"`, `"System Design"`, `"Productivity"` (and others) that are **not** in the classifier set ([routers/seed.py](backend/routers/seed.py)).
- Frontend `Category` type: `'technical'|'personal'|'reference'|'general'` ([frontend/src/lib/types.ts:1](frontend/src/lib/types.ts#L1)) — overlaps with **neither** backend set.
- Impact: `Chunk.category` is typed as a union the backend never produces; category filtering/coloring keys off mismatched strings. Type-safety is illusory here.

### P4-2 — Duplicate search implementations drift apart — VERIFIED
- Evidence: `POST /search` ([search.py:24-82](backend/routers/search.py#L24-L82)) and `GET /search` ([search.py:85-116](backend/routers/search.py#L85-L116)) reimplement the same composite-ranking loop with subtly different output shapes (`SearchResult` vs `to_chunk_full`). The frontend only uses GET ([api.ts:86](frontend/src/lib/api.ts#L86)); POST `/search` appears unused by the SPA.
- Impact: Two code paths, one tested for shape by neither. Drift risk + dead surface.

### P4-3 — Search is O(n) connections per query (N+1) — VERIFIED
- Evidence: both search handlers loop over up to 50 Chroma hits and call `get_chunk(cid, user_id)` ([search.py:37,100](backend/routers/search.py#L37)), each opening **a new SQLite connection** (`_connect()` per call, [db.py:160-167](backend/database/db.py#L160-L167)). 50 connect/close cycles per search.
- Impact: Acceptable at hackathon scale; a measurable latency/throughput tax under load. A single `WHERE id IN (...)` query would replace 50 round-trips.

### P4-4 — `update_chunk_category` bypasses ownership by design — VERIFIED (intentional) / P2
- Evidence: [db.py:305-310](backend/database/db.py#L305-L310) updates by `chunk_id` only, "No user_id check by design" (background classifier). Fine for a server-internal call, but it is a public-signature footgun if ever called from a request path.

---

## 5. P2 — Maintainability, dead code, DX

### P5-1 — Dead frontend components shipped in the bundle — VERIFIED
- `ChunkCard.tsx`, `Card3D.tsx`, `AnimatedBackground.tsx` are imported **nowhere** (`grep` across `src`, excluding their own files, returns nothing). `LoadingSkeleton` is used only by `SearchPage`.
- `mock_chunks.json` is `[]` (empty), `mock_search_results.json`/`mock_discovery.json` are single-line stubs; the mock pathway (`VITE_USE_MOCKS`) would silently render empty data.

### P5-2 — Unused imports / params in backend — PARTIALLY VERIFIED
- `models/schemas.py` imports `datetime` ([schemas.py:1](backend/models/schemas.py#L1)) but never uses it. `ingest_text` recomputes `S` for `access_count=0` via a magic inline formula duplicating `_shared.to_chunk_full` math ([ingest.py:110-111](backend/routers/ingest.py#L110-L111)). (No linter/ruff configured to catch these.)

### P5-3 — Non-deterministic discovery "reason" — VERIFIED
- Evidence: `_REASONS[hash(best_row["id"]) % len(_REASONS)]` ([discovery.py:45](backend/routers/discovery.py#L45)). Python's `hash()` of a str is salted per-process (`PYTHONHASHSEED`), so the same chunk shows different reasons across restarts. Cosmetic, but a correctness-of-intent smell (a stable hash like md5 was intended).

### P5-4 — `seed_demo_data.py` depends on a sibling repo that isn't here — VERIFIED
- Evidence: it walks `../../brain-backup/*.md` ([seed_demo_data.py:30](backend/seed_demo_data.py#L30)) and `sys.exit(1)` if absent. This is a private/local script, not a product seeder. The product seeder is `routers/seed.py` (self-contained). The standalone file is dead weight in the repo and will confuse new contributors.

### P5-5 — No CI, no Dockerfile, no lockfile for backend — VERIFIED
- Evidence: no `.github/`, no `Dockerfile`, no `requirements.lock`/`poetry.lock`/`uv.lock`. `requirements.txt` is unpinned except `torch` ([backend/requirements.txt](backend/requirements.txt)). Reproducible builds are not guaranteed. `Procfile` exists (Heroku-style) but no platform config beyond it + `frontend/vercel.json`.

### P5-6 — README drift — VERIFIED
- "17 pytest cases" (actually 27); `LLM_MODEL` default differs between README (`meta-llama/llama-4-scout-17b-16e-instruct`), `.env.example`, and `llm_service` defaults (`llama-3.3-70b-versatile`). Windows-only `venv/Scripts/activate` and `.testvenv/Scripts/python.exe` test command in a repo deployed on Linux.

---

## 6. What is REAL vs DECORATIVE (frontend feature reality)

Verified by reading `api.ts` wiring + each page (corroborated by sub-agent sweep):

| Feature | Status | Evidence |
|---|---|---|
| Auth (login/register/refresh/logout) | REAL | `AuthContext` → `/api/auth/*` |
| Search | REAL | `search()` → `GET /api/search` ([api.ts:86](frontend/src/lib/api.ts#L86)) |
| Library (list/delete/folder) | REAL | `getAllChunks`/`bulkDeleteChunks`/`moveChunkToFolder` |
| Review (FSRS) | REAL | `getReviewQueue`/`gradeChunk` → `/api/review/*` |
| Quiz | REAL (but see P0-2/3/4) | `startQuiz`/`submitQuiz` |
| Discovery polling | REAL | `getDiscovery` → `/api/discovery` |
| AI summarize/expand/optimize | REAL | `/api/ai/*` |
| File upload | REAL | `ingestFile` → `/api/ingest` |
| **Pomodoro** | **DECORATIVE** | 100% `localStorage`, no backend ([PomodoroPage.tsx](frontend/src/pages/PomodoroPage.tsx)) |
| **Calendar "forget dates"** | **DECORATIVE (approx.)** | client-side Ebbinghaus `predictForgetDate`, not backend FSRS due dates |
| Notes draft editor | LOCAL until "Save" | `useNotes` localStorage; persists only on explicit ingest |
| Client-side note encryption | REAL but lossy | AES-GCM in browser, no key recovery ([NoteDetailPanel.tsx:18-47](frontend/src/components/notes/NoteDetailPanel.tsx#L18-L47)) |

Decorative ≠ broken, but a paying user expecting Pomodoro stats or calendar reminders to persist/sync will be surprised. Either label them "local only" or wire them.

---

## 7. Prioritized remediation backlog (drives Agent 3)

| ID | Fix | Effort | Validates via |
|---|---|---|---|
| P0-1 | Re-embed + update Chroma on chunk edit | S | new pytest (mock embed) |
| P0-2 | Call `complete_quiz_session` in `/submit`; add history read | S | pytest |
| P0-4 | Make `/quiz/answer` server-authoritative (look up correct_index server-side) | M | pytest |
| P0-5 | Purge expired/revoked refresh tokens (on refresh + startup) | S | pytest |
| P1-1 | Add structured logging + request IDs | M | startup/import |
| P1-2 | Rate-limit auth + AI endpoints | M | pytest |
| P1-3 | Tighten default CORS to explicit allow-list | S | import |
| P1-5 | Sanitize markdown/highlight HTML (DOMPurify) | S | build |
| P1-6 | Adopt Alembic (or a versioned migration runner) | L | pytest + DATABASE_REVIEW |
| P1-7 | Fail fast on missing prod `JWT_SECRET` at startup | S | pytest |
| P4-1 | Unify category taxonomy across 3 layers | M | pytest + build |
| P5-1 | Delete dead components/mocks or wire them | S | build |
| P5-5 | Add lint config, Dockerfile, pinned deps, CI | L | lint/build |

See `DATABASE_REVIEW.md`, `UI_REVIEW.md`, `PRODUCT_GAPS.md`, and `ARCHITECTURE_REFACTOR.md` for the deep dives. Post-change verification is in `QA_REPORT.md`; independent challenge in `CHALLENGE_REPORT.md`.
