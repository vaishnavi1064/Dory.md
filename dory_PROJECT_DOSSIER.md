# Dory.md — Project Dossier

> **Purpose:** A verified, recruiter-facing record of what this repository actually contains.
> Every non-obvious claim below cites a file, test, command output, or commit.
> Claims I could not verify are labeled as such rather than repeated as fact.
>
> **Analysis date:** 2026-09-11 · **Commit analyzed:** `feb3921` (branch `main`)
> **Verification environment:** Windows 11, `backend/venv` = Python 3.12.10 with the full ML
> stack installed (torch 2.5.1+cpu, sentence-transformers 5.5.1, chromadb 1.5.9, fsrs, groq 1.4.0),
> Node v24.11.1 / npm 11.6.2. No Groq API key was configured, which let me verify the
> graceful-degradation path directly.

**Tier legend**

| Tier | Meaning |
|---|---|
| **[BUILT]** | Implemented in code and verified working (test, command output, or my own runtime probe) |
| **[PARTIAL]** | Real code exists but is stubbed, single-node-only, approximate, or verified only at the wiring level |
| **[PLANNED]** | Claimed in the README / docs but not verifiable in the code |

---

## 1. One-line summary

Dory.md is a full-stack notes application that models how fast you are forgetting each note using an Ebbinghaus forgetting-curve score, then uses that decay signal to re-rank semantic search, schedule FSRS-4 spaced-repetition reviews, and generate quizzes from your lowest-retention material.

---

## 2. Problem & purpose

**The stated problem** (`README.md`, "The problem"): people capture notes constantly but forget most of the content within days, and have no visibility into *which* notes are decaying. Conventional note apps rank by recency or keyword relevance — neither correlates with what you are about to lose.

**The approach.** Dory.md attaches a continuous, per-chunk memory-retention score to every piece of ingested text and makes that score a first-class ranking signal across the product:

- Search ranks by `0.4·similarity + 0.4·decay_urgency + 0.2·recency`, so a note you are forgetting can outrank a note that merely matches better ([intelligence/ranking/scoring.py:11-13](intelligence/ranking/scoring.py#L11-L13)).
- Quizzes are drawn from the lowest-retention chunks, not random ones ([backend/routers/quiz.py:64-84](backend/routers/quiz.py#L64-L84)).
- A "Time Machine" projects retention forward in time so you can see what will be gone in 30 days ([backend/routers/health.py:16-22](backend/routers/health.py#L16-L22)).

**Context.** Built for **UWB Hacks: The Future! 2026** (README badge), then carried substantially past hackathon scope through a documented production-hardening pass (`docs/AUDIT_REPORT.md`, `docs/FINAL_REPORT.md`) and two later feature waves. This matters for honest framing: it is a hackathon project that received real post-hackathon engineering, not a product with users.

---

## 3. What I built

### Intelligence / memory-science layer — [BUILT]

| Component | File | Verification |
|---|---|---|
| Ebbinghaus retention engine `R(t) = e^(−t/(S·k·BASE))`, `BASE = 216 h` | [intelligence/memory/ebbinghaus.py](intelligence/memory/ebbinghaus.py) | 5 unit tests (`test_fresh_chunk_has_high_retention`, `test_retention_decreases_over_time`, `test_more_reviews_slow_decay`, `test_classify_retention_buckets`, `test_batch_matches_scalar`) |
| 4-bucket classifier (strong ≥ 0.8 / fading ≥ 0.5 / weak ≥ 0.2 / critical) as a single source of truth shared with the SPA | [ebbinghaus.py:78-92](intelligence/memory/ebbinghaus.py#L78-L92) | `test_classify_retention_buckets`; mirrored in [Dashboard.tsx:105-113](frontend/src/pages/Dashboard.tsx#L105-L113) |
| NumPy-vectorized batch retention for the Time Machine | [ebbinghaus.py:58-77](intelligence/memory/ebbinghaus.py#L58-L77) | `test_batch_matches_scalar` asserts batch ≡ scalar within 1e-9. **Speedup claim is overstated — see §7** |
| FSRS-4 spaced-repetition scheduler wrapping the `fsrs` package | [intelligence/memory/scheduler.py](intelligence/memory/scheduler.py) | 10 tests in `backend/tests/test_review_loop.py` |
| Composite search ranking + display metrics | [intelligence/ranking/scoring.py](intelligence/ranking/scoring.py) | `test_composite_score_weights`, `test_recency_bonus_monotonic`, `test_display_metrics_ranges` |
| Semantic chunker (280-word target, 38-word overlap, paragraph → sentence fallback) | [intelligence/domain/chunking.py](intelligence/domain/chunking.py) | `test_chunk_text_returns_nonempty_for_real_text` |
| Complexity scorer (0.4 length + 0.4 vocabulary richness + 0.2 code-presence) feeding the `k` decay modifier | [intelligence/domain/complexity.py](intelligence/domain/complexity.py) | `test_complexity_score_in_range` asserts code scores above repetitive prose |
| Enforced architectural boundary: nothing under `intelligence/` may import backend modules | — | `test_intelligence_does_not_import_backend` AST-parses every non-test file and fails on any forbidden import |

### Retrieval & embeddings — [BUILT]

- `all-MiniLM-L6-v2` SentenceTransformer behind a lazy singleton, warmed once at startup ([intelligence/embeddings/provider.py](intelligence/embeddings/provider.py)).
- ChromaDB persistent store, collection `dory_chunks`, cosine HNSW index, per-user metadata filtering ([intelligence/retrieval/vector_store.py](intelligence/retrieval/vector_store.py)).
- **I verified this at runtime** (the repo's own docs marked it UNVERIFIED): 384-dim vectors confirmed; query *"how do I search a sorted array fast?"* returned the binary-search document at cosine similarity **0.4106** vs **0.0280** for a gradient-descent doc and **−0.0050** for an unrelated personal note. See §7.

### API layer — [BUILT]

**43 application routes (40 under `/api`)**, enumerated from the live FastAPI route table:

- **Auth** (4): register, login, refresh with rotation + revocation, logout.
- **Chunks** (6): list/sorted, detail, update (re-embeds), delete, bulk-delete, folder move.
- **Ingest** (2): multipart files and JSON text.
- **Retrieval/analytics** (6): `POST /search`, `GET /search`, `/discovery`, `/fading`, `/stats`, `/health` (Time Machine).
- **Review** (3), **Quiz** (4), **AI** (3), **Account** (2), **Mood** (3), **Meetings** (5), **Seed** (1).
- **Infra** (3): `/`, `/livez`, `/readyz`.

### Security & correctness work — [BUILT]

| Feature | Evidence |
|---|---|
| bcrypt password hashing; JWT access (1 h) + refresh (30 d) with rotation, SHA-256-hashed storage, and revocation | [backend/routers/auth.py](backend/routers/auth.py); 8 tests in `test_auth.py` |
| Per-user data isolation on every chunk operation | 6 tests in `test_chunk_authz.py` (read/update/delete/folder/review/bulk all 404 cross-user) |
| Ghost-token rejection: a validly-signed JWT for a deleted user is refused | [deps.py:50-54](backend/routers/deps.py#L50-L54); `test_ghost_user_jwt_rejected` |
| Server-authoritative quiz scoring — a forged `correct_index` is ignored | [quiz.py:129-147](backend/routers/quiz.py#L129-L147); `test_quiz_answer_ignores_client_supplied_correct_index` |
| Dual-write integrity: a ChromaDB failure rolls back the SQLite rows, per-file atomically, with a structured partial-failure body | [ingest.py:99-131](backend/routers/ingest.py#L99-L131); 4 tests in `test_dual_write_integrity.py` |
| Server-side upload limits (20 files / 10 MB per file / 20 MB total), enforced before any parsing or DB write | [ingest.py:29-63](backend/routers/ingest.py#L29-L63); 4 tests in `test_ingest_limits.py` |
| Sliding-window per-IP rate limiter, inert in dev, active by default elsewhere | [backend/ratelimit.py](backend/ratelimit.py); `test_ratelimit.py` |
| GDPR account export (excludes `password_hash` and `refresh_tokens`) and hard delete across both stores | [backend/routers/account.py](backend/routers/account.py); 11 tests across `test_account.py` + `test_account_export.py` |
| DOMPurify sanitization of every `dangerouslySetInnerHTML` sink | [frontend/src/lib/sanitize.ts](frontend/src/lib/sanitize.ts) |
| Single in-flight refresh shared across concurrent 401s, so parallel requests don't race and burn rotating refresh tokens | [frontend/src/lib/tokens.ts:29-63](frontend/src/lib/tokens.ts#L29-L63) |

### Frontend — [BUILT]

React 18 + Vite 5 + TypeScript SPA, 11 routed pages ([frontend/src/App.tsx](frontend/src/App.tsx)): Dashboard, Search, Quiz, Review, Library, Calendar, Meetings, Notes editor, Pomodoro, Mood, Settings. 8,170 lines of TS/TSX plus 701 lines of CSS. Typecheck, strict lint, and production build all pass (§7).

### Later feature waves — [BUILT] (commit `0fcbc7a`, 2026-06-26)

Meetings CRUD with URL-scheme validation (19 tests, including 9 that reject `javascript:`, `data:`, `mailto:`, and `ftp:` links), mood tagging with aggregate insights (8 tests), account export/delete (11 tests), a wellness scheduler, and a Pomodoro timer with a synthesized Web Audio fallback chime.

### [PARTIAL]

| Item | Why it is partial |
|---|---|
| **Multi-worker quiz scoring** | The answer key lives in a process-local dict (`_session_store`, [quiz.py:33](backend/routers/quiz.py#L33)). With more than one worker, `/quiz/start` and `/quiz/{id}/submit` can land on different processes. Explicitly documented as open in `docs/FINAL_REPORT.md` §3 and flagged in the code comment itself. |
| **Dashboard / Calendar retention projection** | `projectRetention` in [useDashboardData.ts:42-52](frontend/src/lib/useDashboardData.ts#L42-L52) is a client-side approximation, self-described as "cheap local approximation"; the exact math lives in `GET /api/health`. Numbers can diverge from the server. |
| **LLM category classification & quiz generation** | The code path is complete and degrades gracefully, but I could not verify *output quality* without a Groq key. I did verify the degradation path works (§7). |
| **Chunk re-embed on edit** | Wiring is covered by `test_edit_reembeds_chunk` with a stubbed embedder. The real model + HNSW upsert path is not asserted by a test (though I verified the equivalent ingest path at runtime). |
| **Rate limiter** | Correct and tested, but per-process and in-memory — the module docstring says so plainly and names Redis as the multi-node fix. |
| **Demo login on the deployed site** | The backend refuses `demo@dory.md` when `DORY_ENV != dev` ([auth.py:136-138](backend/routers/auth.py#L136-L138)), but the SPA falls back to a fabricated local session on any login failure for those exact credentials ([AuthContext.tsx:55-77](frontend/src/contexts/AuthContext.tsx#L55-L77)). The user appears logged in with no token, so authenticated calls would 401. Flagged as P1-4 in `docs/AUDIT_REPORT.md` and still present in the code. |
| **`seed_demo_data.py`** | Reads from a `../brain-backup/` directory that is not in the repo, so it cannot run from a fresh clone. The working path is `POST /api/seed` (55 built-in chunks). |

### [PLANNED]

From the README "Coming in v2" section — none of these appear in code (verified by search): hybrid BM25 + dense retrieval with Reciprocal Rank Fusion, accessibility-first redesign, voice capture, quiz confidence calibration, goal tracking, per-user FSRS parameter optimization.

---

## 4. Tech stack & tools

Taken from `backend/requirements.txt`, `frontend/package.json`, `intelligence/pyproject.toml`, `Dockerfile`, and `.github/workflows/ci.yml` — not inferred.

**Backend / ML (Python ≥ 3.11; CI and Docker pin 3.12)**
`fastapi`, `uvicorn[standard]`, `torch==2.5.1+cpu` (CPU-only wheel via PyTorch's extra index), `sentence-transformers`, `chromadb`, `fsrs`, `numpy`, `scikit-learn`, `pdfplumber`, `python-docx`, `beautifulsoup4`, `python-jose[cryptography]`, `bcrypt`, `python-multipart`, `python-dotenv`, and three LLM SDKs (`groq`, `openai`, `anthropic`).

**Frontend**
React 18.3, Vite 5.4, TypeScript 5.5, Tailwind CSS 3.4, Framer Motion 11, React Router 6.26, Recharts 2.12, `lucide-react`, `marked` + `dompurify`, `mammoth` (DOCX), `clsx` + `tailwind-merge`. ESLint 9 flat config with `--max-warnings 0`.

**Storage**
SQLite in WAL mode with `foreign_keys=ON` and a 5 s busy timeout ([database/db.py:20-28](backend/database/db.py#L20-L28)); ChromaDB persistent client, cosine HNSW, telemetry disabled.

**Models**
Embeddings: `all-MiniLM-L6-v2`, 384-dim (verified at runtime). LLM: provider-switchable via two env vars across Groq / OpenAI-compatible / Ollama / Anthropic ([intelligence/llm/provider.py](intelligence/llm/provider.py)). Note a documentation drift: `README.md` names `llama-3.3-70b-versatile` as the default while `backend/.env.example` names `meta-llama/llama-4-scout-17b-16e-instruct`.

**Infra**
`Dockerfile` (python:3.12-slim, layer-cached deps, volume for `backend/data`, `DORY_ENV=production` by default). `backend/Procfile` for Render. `frontend/vercel.json` SPA rewrite. GitHub Actions CI with two jobs — backend+intelligence pytest on Python 3.12, and frontend tsc/lint/build on Node 22.

**Packaging detail worth noting:** `intelligence/pyproject.toml` declares only `numpy` and `fsrs` as hard dependencies and pushes `sentence-transformers`/`torch`, `chromadb`, and the LLM SDKs into optional extras (`embeddings`, `retrieval`, `llm`, `all`), each behind a lazy import. The domain layer can be installed without the heavy ML stack — which is exactly what `requirements-test.txt` exploits to keep CI light.

---

## 5. Architecture & how it works

```
React SPA (Vite)
   │  REST + JWT Bearer; 401 → single in-flight refresh → retry
   ▼
FastAPI  (main.py)
   ├─ middleware: global per-IP rate limit → request-ID + timing logger
   ├─ lifespan: require_secret_configured → init_db → setup_demo_user
   │            → purge_expired_refresh_tokens → warm_model
   │            → background thread: classify_all_uncategorized
   └─ 16 routers under /api
          │
          ├──────────────► intelligence/   (pure domain, no HTTP, no DB)
          │                  memory/ · embeddings/ · retrieval/ · ranking/ · llm/ · domain/
          │
          ├──────────────► SQLite (WAL)    content, metadata, FSRS state, logs
          └──────────────► ChromaDB        384-dim vectors, cosine HNSW, user_id metadata
```

**The load-bearing architectural rule** is that the dependency arrow only ever points backend → intelligence, never the reverse, and it is machine-enforced rather than documented-and-hoped: `test_intelligence_does_not_import_backend` AST-parses every non-test module under `intelligence/` and fails the build on any import of `database`, `routers`, `models`, `services`, or `main`. `backend/main.py` puts the repo root on `sys.path` so the sibling package resolves ([main.py:10-16](backend/main.py#L10-L16)).

### Flow 1 — Ingest (`POST /api/ingest`)

1. Read and size-check **all** files up front — limits are enforced before any parsing, embedding, or DB write ([ingest.py:46-58](backend/routers/ingest.py#L46-L58)).
2. `parsers/file_parser.parse()` dispatches by extension to PDF (`pdfplumber`), DOCX (`python-docx`), HTML (`beautifulsoup4`), JSON (re-serialized pretty), or UTF-8 text with `errors="replace"`.
3. `intelligence.domain.chunk_text` → paragraph-merge to a 280-word target, sentence-split anything oversized, then prepend a 38-word overlap from the previous chunk.
4. `complexity_score` per chunk → stored as the `k` modifier for the decay curve.
5. `embed_texts` runs in the default threadpool via `run_in_executor` — the deliberate reason being that sentence-transformers is CPU-bound and would otherwise block the event loop for every other request ([ingest.py:75-77](backend/routers/ingest.py#L75-L77)).
6. Insert rows into SQLite, then `add_chunks` into ChromaDB. **On vector-store failure, only this file's SQLite rows are deleted**; already-ingested files remain (they are consistent in both stores) and remaining files are reported as `skipped_files` so the client can retry precisely the failed and skipped ones.
7. Category classification is queued as a FastAPI `BackgroundTask` so the LLM round-trip never blocks the upload response.

### Flow 2 — Search (`GET|POST /api/search`)

`embed_query` → `query_similar` pulls the top 50 candidates filtered by `user_id` metadata, converting cosine distance to similarity as `1 − d` → for each candidate, fetch the SQLite row, compute live Ebbinghaus retention and a recency bonus, then `composite_score(sim, retention, recency)` → sort descending → truncate to `limit`.

`POST /search` additionally picks a "discovery" result: among the top 10, the one maximizing `(1 − retention) · similarity` subject to `retention < 0.5` ([search.py:44-54](backend/routers/search.py#L44-L54)).

### Flow 3 — Review (FSRS-4)

`GET /api/review/queue` returns cards ordered by `fsrs_due` (index `idx_chunks_fsrs_due` on `(user_id, fsrs_due)`). `POST /api/review/grade` reconstructs an `fsrs.Card` from the row's six `fsrs_*` columns, calls `Scheduler.review_card`, and returns the new column values as a dict for the backend to persist. The scheduler module is pure — it never touches the database.

There are deliberately **two** memory models: Ebbinghaus produces the *continuous* score that drives dashboards, the fading feed, and search ranking; FSRS-4 drives *discrete* review scheduling. The module docstring justifies FSRS over SM-2 on the grounds that FSRS separates stability from difficulty where SM-2 conflates both into one ease factor.

### Flow 4 — Quiz

Pull 50 stale candidates via SQL, then **re-rank in Python by true Ebbinghaus retention** and take the lowest 5. This is the point of `test_quiz_retention.py`: the SQL proxy (`last_accessed`, `access_count`) and the real formula disagree, and the test constructs the disagreement explicitly — a chunk 30 days stale but reviewed 200 times with max complexity retains ≈ 0.63, while one only 10 days stale but never reviewed and minimally complex retains ≈ 0.11. The test asserts the fragile chunk is quizzed first.

The correct answers are held server-side keyed by session id; `/quiz/answer` looks up its own key and only grants the retention reward when the server itself verified the answer.

---

## 6. How I built it — notable implementation details

**Two-phase dual-store writes with per-file atomicity.** The genuinely hard problem here is that every chunk lives in two stores that have no shared transaction. The solution is per-file compensation rather than a global rollback: a failure on file 2 of 3 leaves file 1 intact, rolls back only file 2, and reports file 3 as skipped, with a response body that tells the client exactly what to retry. `test_ingest_partial_batch_returns_structured_failure` asserts all three states simultaneously. Deletes take the mirrored stance — a vector-store delete failure after the SQLite row is gone is surfaced as a 500 with a `logger.critical`, not swallowed.

**Ordering deletion to fail safe.** Account deletion removes ChromaDB vectors *first*, so a failure aborts before SQLite is touched and the client can safely retry; the reverse order would leave unrecoverable orphans. The one irreducible bad case (Chroma succeeded, SQLite failed) is logged at `critical` for manual reconciliation ([account.py:44-79](backend/routers/account.py#L44-L79)).

**Hand-rolled idempotent migrations.** `_migrate()` reads `PRAGMA table_info` and conditionally `ALTER TABLE`s, including backfilling `fsrs_due` from `last_accessed`/`created_at` so pre-existing chunks become immediately reviewable rather than invisible. One migration rebuilds `chunk_state_log` through a copy-and-rename to relax a `NOT NULL` on `chunk_id` — SQLite cannot drop a constraint in place. There is no Alembic; `docs/DATABASE_REVIEW.md` D-1/D-2 names this as a known high-severity gap.

**Defense against refresh-token races.** Refresh rotation means two concurrent 401s could each spend the same refresh token and one would lose. `tokens.ts` memoizes a single in-flight refresh promise and hands the same promise to every concurrent caller. On the server, every JWT carries a `jti` so two tokens issued in the same second for the same user cannot collide on their SHA-256 storage hash ([auth.py:58-60](backend/routers/auth.py#L58-L60)).

**Graceful degradation as a design constraint, not an afterthought.** `complete_json` catches every exception and returns a caller-supplied fallback, and it strips markdown code fences because models wrap JSON in them ([provider.py:88-105](intelligence/llm/provider.py#L88-L105)). `generate_mcq` additionally validates the returned `correct_index` is an int and clamps it into range, falling back entirely if `options` is not a list of ≥ 2. The quiz ships a 5-question fallback bank. I confirmed at runtime that ingest returns **200** with no API key configured, after the Groq client exhausts its retries in the background task.

**Secure-by-default environment handling.** `is_dev_env()` treats any unset or unrecognized `DORY_ENV` as production, so rate limiting is on and demo login is off unless you explicitly opt into dev. The JWT secret has no fallback at all and the app refuses to boot without it.

**Test isolation.** Each test gets a fresh SQLite file via `tmp_path`, specifically to avoid cross-test WAL lock contention from the previous test's files ([conftest.py:37-45](backend/tests/conftest.py#L37-L45)). Env vars are set *before* `main` is imported because module-level config reads them at import time.

**Bundle splitting.** `vite.config.ts` manually chunks `react`/`react-dom`/`react-router-dom` into `vendor` and `recharts` into `charts`, keeping the main bundle separable from the 411 KB charting library.

---

## 7. Metrics

### Verified by me on 2026-09-11

| Metric | Value | How measured |
|---|---|---|
| **Backend test suite** | **81 passed** in 58.99 s | `pytest tests/ -q` in `backend/` with `DORY_ENV=dev DORY_SKIP_WARMUP=1` |
| **Intelligence test suite** | **11 passed** in 0.09 s | `pytest intelligence/tests/ -q` |
| **Total automated tests** | **92 passing, 0 failing** | sum of the two runs above |
| **Test-to-app code ratio** | 1,596 lines of tests against 4,663 lines of Python app code | `wc -l`, excluding `venv/` |
| **Frontend typecheck** | exit 0 | `npx tsc --noEmit` |
| **Frontend lint (strict)** | exit 0 with `--max-warnings 0` | `npm run lint` |
| **Frontend production build** | exit 0, **2,777 modules** in 21.65 s | `npx vite build` |
| **Bundle sizes (gzipped)** | index 120.03 KB · charts 110.80 KB · mammoth 125.59 KB · vendor 53.72 KB · CSS 8.17 KB | same build output |
| **Embedding dimension** | **384** | runtime probe of `embed_texts` |
| **Model warm-up** | **7.48 s** cold | runtime probe of `warm_model()` |
| **Embedding throughput** | 3 documents in **141.4 ms** (≈ 47 ms/doc, cold cache, CPU) | runtime probe |
| **Query embedding** | **27.9 ms** | runtime probe |
| **ChromaDB vector query** | **7.1 ms** (3-vector collection) | runtime probe |
| **Semantic retrieval quality** | query *"how do I search a sorted array fast?"* → binary-search doc **0.4106**, gradient-descent doc **0.0280**, unrelated personal note **−0.0050** | runtime probe |
| **Live demo reachability** | HTTP **200** at `https://dory-md-fork.vercel.app/login` | `curl -o /dev/null -w "%{http_code}"` |

**End-to-end API latency** (single-chunk corpus, TestClient, real ML stack, server-side timing from the app's own request-logging middleware):

| Endpoint | Latency |
|---|---|
| `POST /api/auth/register` (bcrypt) | 261.9 ms |
| `POST /api/ingest` (parse → chunk → embed → 2 stores) | 351.1 ms |
| `GET /api/search` (embed query + vector query + re-rank) | 142.7 ms |
| `POST /api/review/grade` (FSRS) | 12.6 ms |
| `GET /api/stats` | 9.4 ms |
| `GET /api/review/queue` | 5.0 ms |
| `GET /api/health` (Time Machine, +720 h) | 4.4 ms |

> These are single-run, single-user, local-loopback numbers on a 1-chunk corpus. They are honest measurements of *this* setup, not throughput benchmarks, and should be described as such.

**The core mechanism, verified end-to-end.** I ingested two documents, forced one to zero retention (120 days stale, 0 reviews) and one to full retention (just accessed, 8 reviews), then queried *"binary search on a sorted array"*:

| Rank | Composite score | Retention | Document |
|---|---|---|---|
| 1 | **0.8507** | 0.0000 | "Interpolation search estimates the probe position…" |
| 2 | **0.5012** | 1.0000 | "Binary search repeatedly halves a sorted array…" |

Back-solving the formula, the binary-search chunk had the **higher** raw similarity (≈ 0.75 vs ≈ 0.63) and still lost, because the decay-urgency term contributed 0.4 to the forgotten chunk and 0.0 to the fresh one. This confirms the product's central claim works as specified — and it also exposes a real trade-off, discussed in §11.

### Dataset & repository size

| Metric | Value | Source |
|---|---|---|
| Built-in demo corpus | **55 chunks** across **5 categories** and **4 retention profiles** (17 strong / 19 fading / 11 weak / 8 critical) | parsed from `_SEED_ITEMS` in [backend/routers/seed.py](backend/routers/seed.py) |
| Local dev database | 56 chunks in SQLite, **56 vectors in ChromaDB** — the two stores agree | direct `sqlite3` queries against `backend/data/dory.db` and `chroma.sqlite3` (both gitignored, local only) |
| Application code | 12,833 lines (backend 3,828 py · intelligence 835 py · frontend 8,170 ts/tsx) + 701 lines CSS | `wc -l`, excluding `venv/`, `node_modules/`, tests |
| API surface | 43 application routes, 40 under `/api` | live FastAPI route table |
| Tracked files | 160 | `git ls-files` |
| Commits | **53**, spanning **2026-04-25 → 2026-06-26**, 4 contributors | `git log` |

### Coverage — read this one carefully

`backend/coverage.json` (generated 2026-07-03, **untracked**, so it is a local artifact rather than a committed result) reports:

- **82%** overall statement coverage (2,047 / 2,509) — **but this denominator includes the test files themselves**, which are naturally ~99.5% covered and inflate the figure.
- **72.5%** (1,209 / 1,667) when test files are excluded — the honest application-coverage number, and the one to quote.
- The run measured `backend/` **only**; no `intelligence/` module appears in the report, so the intelligence layer's coverage is unmeasured.
- Best-covered: `models/schemas.py` 100%, `routers/mood.py` 91.1%, `routers/auth.py` 89.9%, `routers/ingest.py` 88.8%. Least-covered: `routers/search.py` 21.6%, `routers/discovery.py` 36.0%, `routers/health.py` 30.8% — the ML-dependent paths, consistent with the suite stubbing embeddings.

> I did not regenerate coverage, so I am reporting the committed artifact's numbers with its caveats rather than asserting them as current.

### Claimed but NOT verified — do not put these on a résumé

| Claim | Where | Status |
|---|---|---|
| **"50-100x faster"** batch retention | [ebbinghaus.py:26](intelligence/memory/ebbinghaus.py#L26) docstring | **Contradicted by measurement.** At N = 2,300 I measured batch **1.195 ms** vs scalar **1.959 ms** — a **1.6×** end-to-end speedup. Breaking it down: the NumPy arithmetic alone is 0.028 ms (~70× faster, so the claim holds for that step in isolation), but `calculate_retention_batch` still runs a Python loop calling `_elapsed_hours` per datetime, costing 1.05 ms and dominating the function. **The 50-100x figure describes the vectorized arithmetic, not the function.** This is a genuine, fixable optimization, not just a documentation error. |
| "under 1 ms for 2,300 chunks" | docstring in `intelligence/decay.py` at commit `25a35db` | A stated *target* in a deleted file, never asserted by a test. Current measurement is 1.195 ms. Do not cite. |
| "FSRS converges … with ~30% fewer reviews than SM-2" | [scheduler.py:14-16](intelligence/memory/scheduler.py#L14-L16) | A claim about the upstream FSRS algorithm from external literature. Not measured in this repo. |
| MTEB benchmark standing of MiniLM | README "The research behind it" | External benchmark, not run here. |
| CI badge is green | README | `gh` is unavailable in this environment, so I could not query GitHub Actions run history. I *did* independently run every command in `ci.yml` locally and all five gates pass. |

---

## 8. Results

**What the system demonstrably does**, based on the runtime verification above:

1. Ingests Markdown, PDF, DOCX, HTML, JSON, and plain text; chunks with overlap; embeds to 384-dim vectors; writes SQLite + ChromaDB atomically per file.
2. Scores continuous per-chunk retention and buckets it into strong/fading/weak/critical, consistently across backend and SPA.
3. Retrieves semantically with meaningful separation (0.41 vs 0.03 vs −0.005 on a 3-document probe) and **re-orders results so a forgotten note outranks a better-matching remembered one** — the differentiating behavior, verified end-to-end.
4. Schedules FSRS-4 reviews: grading a fresh card "Good" returned stability 2.3065, difficulty 2.1181, state 1 (Learning), next due ≈ 10 minutes out. "Again" reschedules within 15 minutes; "Easy" defers well beyond — both asserted by tests.
5. Projects retention forward: on a 1-chunk corpus, `/api/health?time_offset_hours=720` reported average retention dropping from 1.000 to **0.0479** with the chunk reclassified as forgotten.
6. Degrades gracefully with no LLM key — ingest returns 200, classification falls back to `Other`, quizzes use the built-in bank.
7. Enforces per-user isolation across all six chunk operations plus review, quiz, mood, meetings, and export.
8. Exports a user's complete data as JSON with credentials and session tokens excluded, and hard-deletes across both stores.

**What it does not do:** there is no evidence of real users, production traffic, retention-improvement studies, or any measurement that Dory.md actually helps someone remember more. The product hypothesis is well-implemented and grounded in cited literature; it is **not** validated.

---

## 9. Frontend / how results are surfaced

**Dashboard** ([Dashboard.tsx](frontend/src/pages/Dashboard.tsx)) — the primary surface. Retention bucket counts from `/api/stats`; six "horizon chips" (Now, +24 h, +3 d, +7 d, +30 d, +90 d) that re-project every chunk client-side to show future decay; per-category rows sorted worst-retention-first; FSRS due-card previews color-coded by stability (< 1 d red → ≥ 30 d green); a Discovery card polled from `/api/discovery` on a configurable interval (`VITE_DISCOVERY_POLL_MS`, default 30 s).

**Search** — results ranked by composite score, each showing its retention percentage and status, with the single most at-risk match flagged as the discovery result. Stale results are cleared on error rather than left visible (UI_REVIEW U-3).

**Quiz** — Intro → Question → Results flow. Questions are generated from the five lowest-retention chunks; correctness is decided server-side; results return score, XP (`score × 50`), and max streak.

**Review** — FSRS card queue with 1–4 self-grading, showing the resulting next-due date.

**Other surfaces** — Library (folders, bulk delete, inline edit), Calendar (predicted forget dates), Meetings, Notes editor with `marked` + DOMPurify rendering, Pomodoro with a Web Audio fallback chime, Mood dashboard with aggregate insights, and Settings (demo-data seeding, account export, account deletion).

**Cross-cutting:** JWT in `localStorage`; automatic single-flight refresh on 401 with retry, then redirect to `/login` on failure; `ErrorBoundary` around the routed area; Framer Motion page transitions; a `VITE_USE_MOCKS` mode that serves bundled JSON so the UI runs with no Python stack at all.

**API-only surfaces** — `/livez` and `/readyz` for load balancers, and FastAPI's auto-generated `/docs`.

---

## 10. Bugs, errors & challenges

`docs/AUDIT_REPORT.md` is an unusually candid adversarial audit of the team's own code, and the git history shows the findings being closed. Notably, **there are zero `TODO`/`FIXME`/`HACK` markers in any source file** (verified by search across `.py`/`.ts`/`.tsx`/`.yml`/`.sql`) — the one TODO lives in the README, about an optional timer sound. Issues were tracked in documents and closed, not left as inline debt.

### Resolved

| Bug | What was wrong | Resolution |
|---|---|---|
| **P0-1 — stale vectors after edit** | `PUT /chunks/{id}` updated SQLite content but never re-embedded, so search silently ranked the chunk by its *pre-edit* meaning — a core-promise defect for a search product | `_reindex_chunk` added; `upsert_chunk` added to the vector store; `test_edit_reembeds_chunk` asserts the call with correct owner metadata |
| **P0-2 — quiz history never persisted** | `complete_quiz_session` was defined with **zero callers**; `quiz_sessions` accumulated rows that were all "started, never finished" — despite an earlier commit titled "quiz history fix" | Wired into `submit_quiz`; `GET /quiz/history` added; 2 regression tests |
| **P0-4 — client-trusted quiz scoring** | `/quiz/answer` took `correct_index` **from the request body**, so a client supplied both sides of the comparison and could farm `access_count` to forge its own retention | Server-side session map is now authoritative; the reward is gated on server verification; `test_quiz_answer_ignores_client_supplied_correct_index` |
| **P0-5 — unbounded token table** | `purge_expired_refresh_tokens` had zero callers; rotation only set `revoked_at` and never deleted | Called at startup and opportunistically on every refresh |
| **P1-5 — stored XSS chain** | Three unsanitized `dangerouslySetInnerHTML` sinks rendering `marked` output; combined with `localStorage` tokens this was a realistic XSS → full token theft chain | DOMPurify added, `lib/sanitize.ts` created, all sinks routed through it, one removed with dead code |
| **P1-6 — split schema** | `users.name`, `users.password_hash`, `chunks.folder`, and all six `fsrs_*` columns existed **only** as imperative `ALTER TABLE`s, so `schema.sql` gave a reader a wrong picture | `schema.sql` now declares all of them (verified by reading the current file) |
| **P1-7 — misconfiguration failed late** | A missing prod JWT secret 500'd every authenticated request instead of failing at boot | `require_secret_configured()` in the lifespan; the dev fallback secret was removed entirely |
| **Lint was entirely broken** | ESLint 9 requires flat config; no `eslint.config.*` existed, so `npm run lint` crashed — a quality gate that had never run | `eslint.config.js` added; I verified `npm run lint` now exits 0 under `--max-warnings 0` |
| **Dual-store non-atomicity** | Listed as **still open** in `docs/FINAL_REPORT.md` §3 (2026-06-01) | Closed later in commit `0fcbc7a` — `test_dual_write_integrity.py` (4 tests) now passes, so the docs are stale on this point |
| **Quiz selected by SQL proxy, not real retention** | Candidates were ordered by `last_accessed`/`access_count`, which disagrees with the actual formula once stability and complexity are involved | True-retention re-rank added; `test_quiz_retention.py` constructs the disagreement and asserts the fragile chunk wins |
| **Torch image size / Python-version traps** | Commit `748cae5`: "use CPU-only PyTorch to reduce Railway image size (5.8 GB → ~1.5 GB)". Commit `bec3414`: torch 2.4.0 had no Python 3.13 wheel. `torch==2.5.1+cpu` then had no 3.14 wheel, which is why CI and Docker pin **3.12** | CPU-only extra index + pinned interpreter |
| **`sqlite3.Row` has no `.get()`** | Commit `66065a8`: discovery crashed calling `.get()` on a `Row` | Convert to `dict` before access — the pattern is still visible in [discovery.py:30](backend/routers/discovery.py#L30) |
| **Hardcoded dashboard stats** | Commit `99ccbce`: "wire StatsRow to live `/api/stats` (was fully hardcoded)" | Wired to the real endpoint |

### Open / unresolved

1. **Multi-worker quiz scoring (P0-3).** In-memory `_session_store`. Under `--workers > 1`, `/quiz/start` and `/submit` can hit different processes and score against `correct_index = 0`. `docs/CHALLENGE_REPORT.md` C-1 is explicit that the P0-4 fix hardened the *trust model* but not the *store*, and that `_session_store.pop()` after submit does nothing for multi-process. Fix is persisting the key to the DB or Redis.
2. **The demo-login fallback fabricates a session** (P1-4). Still present in `AuthContext.tsx`. On the deployed site, where demo login is server-side disabled, the SPA shows the user as logged in with no token, and every subsequent API call 401s.
3. **No migration framework.** Hand-rolled `_migrate()`, no Alembic, no down-migrations (`DATABASE_REVIEW.md` D-1/D-2).
4. **Ephemeral-disk data loss.** SQLite + Chroma on local disk with no backups; on Render/Fly-style ephemeral filesystems, data is lost on redeploy (`PRODUCT_GAPS.md` §4).
5. **Unmigrated email case.** `CHALLENGE_REPORT.md` C-6: login now lowercases input, but pre-existing mixed-case rows would fail to authenticate until `UPDATE users SET email = lower(email)` is run.
6. **README is materially wrong about the JWT secret.** It documents `JWT_SECRET` as "REQUIRED when `DORY_ENV != dev`" and says dev "uses a permissive JWT default." Both are false: the variable is `DORY_JWT_SECRET` and [deps.py:31-35](backend/routers/deps.py#L31-L35) is called unconditionally at startup with no fallback. **Following the README quickstart on a fresh clone fails to boot.** (`backend/.env.example` has it right; my local run only succeeded because an untracked `backend/.env` supplies it.)
7. **Stale README notes.** The README says `docs/dashboard.png` "is not in the repo yet" — it was added in commit `c507fb8` and is present. The `LLM_MODEL` default also disagrees with `backend/.env.example`.
8. **Docs are frozen at 2026-06-01.** They cite 45 tests (now 92), reference `CORS_ORIGIN_REGEX` where the code now uses an explicit `DORY_CORS_ORIGINS` allow-list, and list dual-store atomicity as open when it has since been closed. They remain valuable as engineering-process evidence but should not be read as a current status report.

---

## 11. Key decisions & trade-offs

**Two memory models instead of one.** Ebbinghaus for continuous scoring, FSRS-4 for discrete scheduling. FSRS alone cannot answer "how well do I remember this *right now*" for every chunk — it only knows about cards you've actively graded, and it emits due dates, not a 0-1 score. Ebbinghaus gives a score for every chunk from `last_accessed` and `access_count` alone, which is what dashboards, the fading feed, and search re-ranking all need. The cost is two models that can disagree about the same chunk; the code manages this by giving each a distinct job and documenting the split.

**FSRS-4 over SM-2**, justified in [scheduler.py:12-17](intelligence/memory/scheduler.py#L12-L17) on the grounds that FSRS separates stability from difficulty where SM-2 conflates them into one ease factor, and that FSRS is fit on real review data. The bundled quantitative claim (~30% fewer reviews) is cited from upstream, not measured here.

**Dense-only retrieval, deferring hybrid BM25+dense to v2.** The README argues this explicitly: a composite re-rank is simpler to reason about and tune, and the decay-urgency signal — not lexical matching — is the actual differentiator. Honest cost: exact keyword and rare-term queries are weaker than a hybrid would be.

**Weighting decay urgency equal to similarity (0.4 / 0.4 / 0.2).** This is the central product bet and I verified it changes real behavior — but my probe also shows the sharp edge: a fully-forgotten chunk carries a flat +0.4 that a *perfectly* relevant fresh chunk (similarity 1.0, contributing 0.4) cannot overcome once recency is comparable. The 0.8507-vs-0.5012 result is the feature working as designed *and* a demonstration that a user searching for something they know well may not get it first. No test pins the weights to a quality outcome, and there is no evaluation set — the weights are a reasoned guess, not a tuned result. Worth saying so in an interview rather than claiming they are optimal.

**`all-MiniLM-L6-v2` over a larger encoder.** Chosen for CPU inference and a ~90 MB footprint. Measured cost: 7.48 s cold warm-up and ~28 ms per query embedding, which is why the model is warmed at startup rather than lazily on first request.

**SQLite + ChromaDB over Postgres + pgvector.** `docs/DATABASE_REVIEW.md` §3 works this through with a decision matrix and accepts the consequences: single-writer lock, no horizontal scaling, non-atomic dual writes, and no backup story. The compensating control is application-level per-file compensation plus `critical` logging on the irreducible cases. For a hackathon-scale deployment this is defensible; the review names the Postgres cutover path rather than pretending the choice is free.

**Extracting `intelligence/` as a standalone domain package.** `docs/CHALLENGE_REPORT.md` §5 explicitly interrogates whether this was over-engineering, since it touched ~15 backend files. Its own counter-evidence: the refactor surfaced a real leak (classification was doing a DB write from inside the "AI" module), it enabled a 0.09-second pure test suite with a machine-enforced boundary, and it left the backend thinner. Verdict recorded as "justified, not gratuitous" — while also conceding the refactor was that pass's largest source of runtime-unverified surface. That self-criticism is more credible than the refactor itself.

**Optional-dependency design.** Making torch/chromadb/LLM SDKs optional extras behind lazy imports is what allows `requirements-test.txt` to run 92 tests without the ML stack — a deliberate CI-speed decision with a real cost, namely that the ML paths are stubbed in tests and needed my separate runtime probe to confirm.

**Secure-by-default env handling.** Any unrecognized `DORY_ENV` is treated as production. Correct default; it is also why the README's wrong variable name is a hard failure rather than a soft one.

---

## 12. What makes it strong / novel

Stated without inflation:

1. **The decay-urgency ranking signal is genuinely differentiated and I verified it works.** Search that deliberately surfaces what you're forgetting over what best matches is not a standard IR objective, and the 0.8507-vs-0.5012 result shows the mechanism reordering results end-to-end, not just existing in a formula.
2. **The architectural boundary is machine-enforced, not aspirational.** An AST-walking test that fails the build on a forbidden import is a meaningfully stronger guarantee than a README diagram, and it is rare in projects this size.
3. **Distributed-consistency handling is real.** Two stores with no shared transaction, handled with per-file compensation, a deliberately-ordered delete sequence that fails safe, structured partial-failure response bodies telling the client exactly what to retry, and four dedicated tests. Most projects at this scale write to both stores and hope.
4. **Two distinct memory models, each doing the job it is suited for**, with the split reasoned about explicitly rather than one being bent to cover both.
5. **`test_quiz_retention.py` is a good test.** It constructs a case where the cheap SQL proxy and the true formula *disagree* and asserts the formula wins — that is testing a correctness property, not a happy path.
6. **The engineering-process artifacts are the strongest single signal.** An adversarial self-audit that labels the team's own code "not production-grade," a challenge report that says "one P0 was deliberately only half-fixed," and a QA matrix with an explicit UNVERIFIED column are evidence of engineering judgment that working code alone cannot demonstrate.
7. **Graceful degradation is verified, not assumed** — the app returns 200 and stays functional with no LLM key at all.

**What is not novel:** the Ebbinghaus curve, FSRS, sentence-transformers, ChromaDB, and JWT auth are all standard, correctly-applied off-the-shelf components. The contribution is the composition and the engineering discipline around it, not new algorithms.

---

## 13. Why it's credible

A skeptical engineer can reproduce all of the following in minutes:

- **92 tests pass** — run them. The suite covers authorization (6 cross-user cases), the FSRS loop (10), dual-store failure injection (4), upload limits (4), meetings validation (19), and GDPR export/delete (11). These are correctness and security properties, not smoke tests.
- **All five CI gates pass locally**, including strict lint at `--max-warnings 0`.
- **The ML path runs**, not just the stubs: 384-dim vectors, sensible cosine separation, working HNSW queries, real FSRS state transitions — I verified each directly.
- **The architectural claim is testable**: delete the boundary test and add `from database.db import ...` to any intelligence module to watch it fail.
- **The audit trail is unusually honest.** `docs/` contains a self-audit naming five P0 defects in the team's own code, and `CHALLENGE_REPORT.md` distinguishes "verified" from "verified only at the wiring level with a stub" for individual fixes. A reviewer can check the closures against the commits.
- **Zero TODO/FIXME markers** across all source files.
- **The live demo responds** (HTTP 200), the CI workflow is committed, and the Dockerfile carries a comment explaining exactly why the Python version is pinned.
- **This dossier itself flags a measurement that contradicts the repo's own docstring** (the 50-100x claim, §7). That is the level of scrutiny the code survives.

---

## 14. Draft résumé bullets

Grounded only in what is verified above. Where no real number exists, the bullet states a concrete qualitative outcome instead of inventing one.

> **1.** Built a memory-decay-aware semantic search engine that surfaces notes a user is about to forget, achieving verified end-to-end retrieval in **143 ms** (384-dim `all-MiniLM-L6-v2` embeddings + ChromaDB cosine HNSW), by implementing a composite re-ranker blending cosine similarity, Ebbinghaus decay urgency, and recency (0.4/0.4/0.2) — demonstrated re-ordering a forgotten chunk (composite 0.85) above a more semantically similar but well-retained one (0.50).

> **2.** Delivered a FastAPI + React learning platform with **92 automated tests passing across two suites** (81 integration, 11 pure-domain) and five green CI gates, by designing an `intelligence/` domain layer whose separation from the web/DB layer is enforced by an AST-walking test that fails the build on any backend import.

> **3.** Eliminated data-integrity defects in a dual-store (SQLite + ChromaDB) write path with no shared transaction, verified by **4 fault-injection tests**, by implementing per-file compensating rollback that preserves already-ingested files, returns a structured partial-failure body identifying exactly which files to retry, and orders account deletion so a vector-store failure aborts before relational data is touched.

> **4.** Closed **5 P0 correctness and security defects** found in a self-directed adversarial audit — including a client-trusted quiz-scoring endpoint that let users forge their own memory-strength metric and a stale-embedding bug that silently corrupted search after any note edit — by moving scoring to a server-authoritative session key and re-embedding on write, each locked in by a regression test.

> **5.** Implemented dual-model spaced repetition combining an Ebbinghaus retention score (`R(t) = e^(−t/(S·k·216h))`, NumPy-vectorized for bulk projection) with FSRS-4 scheduling, plus an LLM quiz generator that selects the lowest-retention chunks by **true retention rather than a SQL recency proxy** — a distinction pinned by a test where a 30-day-stale-but-heavily-reviewed chunk correctly ranks as better-retained than a 10-day-stale, never-reviewed one.

**Do not use in bullets:** "50-100× faster" (measured 1.6× end-to-end), "82% coverage" without stating that the honest app-only figure is 72.5% and excludes `intelligence/`, or any claim of users, production traffic, or measured learning improvement.

---

## 15. Impact & value

**The honest framing: this demonstrates capability. It is not in production use.**

There is no evidence in the repository of real users, production traffic, uptime data, or any study showing the system improves recall. The live demo is reachable and the code is deployable, but nothing indicates it is *deployed for anyone*. Presenting it as a product with impact would be a claim the repo cannot support.

**What it does legitimately demonstrate:**

- **Full-stack ownership at real scale** — 12,833 lines of application code spanning a React/TypeScript SPA, a 43-route FastAPI service, a domain package, two storage systems, and CI/Docker/deploy config.
- **Applied ML judgment beyond calling an API** — embedding model selection with a stated trade-off (CPU/90 MB footprint against quality), a vector index configured deliberately (cosine HNSW, metadata-filtered per user), and a custom ranking function that composes a domain signal with semantic similarity.
- **Engineering maturity that is hard to fake** — a self-directed adversarial audit of one's own code, a documented refusal to claim a half-fixed P0 as fixed, and a QA matrix with an explicit UNVERIFIED column. In an interview this is more differentiating than the features.
- **Security and privacy taken seriously for a hackathon project** — per-user isolation tested across every mutating operation, server-authoritative scoring, GDPR export/delete with credentials and session tokens explicitly excluded, XSS sinks sanitized, upload limits enforced pre-parse.
- **A genuinely interesting product idea, correctly implemented** — using a forgetting-curve model as a retrieval ranking signal, grounded in cited literature (Murre & Dros 2015; Roediger & Karpicke 2006; Reimers & Gurevych 2019; Malkov & Yashunin 2016), with the mechanism verified working end-to-end.

**Scope honesty for interviews.** This is a 4-person hackathon project (UWB Hacks 2026) that received substantial post-hackathon hardening over roughly two months. Across 53 commits, `git shortlog` attributes ~32 to Nikhil Pawar, ~17 to Vaishnavi Chaughule (across three identity spellings), and 3 to Shraddha Deshpande. The README assigns you the intelligence layer — decay engine, semantic search, quiz pipeline — and the history is consistent with that (`d97f315`, `25a35db`, `152afc5` build the original intelligence package; `0fcbc7a` adds the meetings/mood/export/wellness wave and the dual-write, ingest-limit, and quiz-retention test suites). **One nuance to be ready for:** the *current* `intelligence/` package was restructured out of `backend/core` and `backend/services` in the June 1 hardening commit `85bbb3c` (authored by Nikhil), after your original `intelligence/decay.py`, `search.py`, `embedder.py`, `quiz.py`, and `classifier.py` were removed in `09bd8fa` (May 10). Your original decay engine established the formula and the `BASE_HOURS=216` constant that the current code still uses — commit `392ddb4`, "fix(decay): scale formula by BASE_HOURS=216 to align with intelligence branch," is the backend adopting your model. Framing the decay engine and Time Machine math as yours is supported by the history; claiming sole authorship of the current package layout is not. Confirm the split with your teammates before finalizing (see §16).

---

## 16. Gaps / open questions

I was able to read the filesystem, run git, execute both test suites, run the full frontend toolchain, and exercise the real ML stack end-to-end, so nothing below is blocked on missing access. These are questions only you can answer.

### For you to confirm

1. **Contribution split.** The strongest bullets (dual-write integrity, quiz true-retention ranking, ingest limits, GDPR export) come from commit `0fcbc7a`, which is yours. The P0 security fixes and the current `intelligence/` package layout come from `85bbb3c`, authored by Nikhil. Confirm with teammates which you can claim, and consider phrasing bullet 4 as contributed-to rather than sole work if the audit was a shared effort.
2. **Who wrote the `docs/` reports?** They are the single most impressive artifact here, but commit `85bbb3c` ("commit changes") attributes them to Nikhil. If they were AI-assisted or team-produced, say so if asked — the reports themselves model exactly that kind of honesty.
3. **Was there ever a benchmark run** behind "50-100x faster" or "under 1 ms for 2,300 chunks"? My measurement (§7) contradicts the first at the function level. If you have a saved benchmark, share it; otherwise treat both as unsupported.
4. **Hackathon outcome** — did Dory.md place or win an award? Not recorded in the repo, and it would be worth a résumé line.
5. **Is the Render backend still running?** The Vercel frontend returns 200, but if the API is down the demo is UI-only. Worth checking before putting the link on an application.
6. **Team size and duration for the résumé header** — 4 contributors, 2026-04-25 → 2026-06-26 per git. Confirm the hackathon dates separately from the hardening period.

### Fixes worth making before anyone reviews this repo

1. **The README JWT variable is wrong and breaks a fresh clone's quickstart** (§10, item 6). Change `JWT_SECRET` → `DORY_JWT_SECRET` and drop the "permissive default in dev" sentence. This is the highest-value 30-second fix in the repo — a recruiter-engineer who tries to run it will hit this first.
2. **Remove the stale "add a dashboard screenshot… the image is not in the repo yet" placeholder** — the image exists.
3. **Either fix or soften the "50-100x faster" docstring.** The real fix is small: vectorize the `_elapsed_hours` loop by converting timestamps to a NumPy array once instead of per-element, which would likely make the claim true.
4. **Reconcile `LLM_MODEL` defaults** between `README.md` and `backend/.env.example`.
5. **Add a dated banner to `docs/`** noting the reports reflect the 2026-06-01 state (45 tests, dual-write then open) and that the current state is 92 tests with dual-write closed. Without it, a reader may think the open items are still open.
6. **Consider removing the demo-login fallback** in `AuthContext.tsx` — on the deployed site it produces a confusing fake-logged-in state with no token.

### Not determinable from the repo

- Real-world quiz-generation quality (needs a Groq key and human evaluation).
- Search ranking quality at scale — there is no evaluation set, no relevance judgments, and no tuning record for the 0.4/0.4/0.2 weights.
- Whether GitHub Actions CI is actually green (`gh` unavailable here; every gate passes locally).
- Production performance under concurrency — all latency figures are single-user, local-loopback, small-corpus.
- Whether the deployed instance has ever been used by anyone other than the team.
