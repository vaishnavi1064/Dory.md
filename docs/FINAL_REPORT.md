# Dory.md — Production-Hardening Pass: Final Report

**Date:** 2026-06-01
**Principle:** Evidence > persuasion. Every claim below is tied to a command output or a file. Where something could not be executed in this environment, it is labeled **UNVERIFIED (runtime)** — not asserted as done.

Companion documents: `AUDIT_REPORT.md`, `DATABASE_REVIEW.md`, `UI_REVIEW.md`, `PRODUCT_GAPS.md`, `ARCHITECTURE_REFACTOR.md`, `CHALLENGE_REPORT.md`, `QA_REPORT.md`.

---

## 1. Executive summary

Dory.md is a genuinely strong demo: real ML-backed memory-decay features, **correct and well-tested auth + per-user isolation**, and a coherent design system. It was **not** production-grade: stale-vector-on-edit, half-wired quiz history, a client-trusted scoring path, an unbounded token table, zero observability, no rate limiting, a broken lint, no CI/Docker, and all "intelligence" logic tangled into the web/DB layer.

This pass: established a **truthful baseline** (27 backend tests pass; lint was outright broken; `requirements.txt` can't install on Python 3.14), then made **verified, test-backed** changes:
- Fixed 4 of the 5 P0 correctness/security defects (the 5th — multi-worker quiz store — is explicitly left open with rationale).
- Added observability, rate limiting, fail-fast config, email validation, tighter CORS, liveness/readiness probes.
- Extracted a clean, boundary-enforced **`intelligence/` domain layer** (Agent 2B mandate).
- Repaired the frontend lint, removed dead code, sanitized XSS sinks, added mobile navigation, aligned the retention/category taxonomy.
- Added CI, a Dockerfile, and a reproducible test-deps manifest.

**Test count went 27 → 45, all passing. Frontend tsc/lint/build all green (lint was previously broken).**

---

## 2. What was ACTUALLY fixed (VERIFIED)

Each is backed by a passing test or a passing build gate.

| ID | Fix | Verification |
|---|---|---|
| P0-1 | Chunk edit now re-embeds + upserts the vector (no more stale search) | `test_edit_reembeds_chunk` (wiring; real model UNVERIFIED — see §4) |
| P0-2 | Quiz sessions are marked completed; `GET /api/quiz/history` added | `test_submitting_quiz_records_completed_session`, `test_quiz_history_*` |
| P0-4 | `/quiz/answer` scores against the server-side key; forged `correct_index` ignored; reward gated on server verification | `test_quiz_answer_ignores_client_supplied_correct_index` |
| P0-5 | Expired/revoked refresh tokens purged (on refresh + at startup) | wired in `auth.refresh` + lifespan; 34 tests still green |
| P1-1 | Structured logging + per-request `X-Request-ID` middleware | `observability.py`, middleware in `main.py`; suite green |
| P1-2 | In-memory rate limiter on auth + AI endpoints (on in prod, inert in dev) | `test_ratelimit.py` (429 path + dev-inert path) |
| P1-3 | CORS default no longer allows arbitrary public IPs | `main.py` regex; app boots |
| P1-7 | Missing prod `JWT_SECRET` fails at **boot**, not per-request | `require_secret_configured()` in lifespan |
| P1-8 | `/livez` + `/readyz` infra probes | present in route table (verified) |
| P4-1 | Category taxonomy unified to one source of truth (classifier + seed + frontend) | `intelligence/llm/categorization.CATEGORIES`; build green |
| Val. | Email format validation + normalization on register/login | field validators; suite green |
| Arch | `intelligence/` layer extracted; backend consumes via public interfaces; **no backend imports inside intelligence** | 45 tests incl. AST boundary test |
| FE-1 | `npm run lint` repaired (was crashing — no ESLint 9 flat config) | `eslint.config.js`; `npm run lint` exits 0 strict |
| FE-2 | All 3 `dangerouslySetInnerHTML` sinks sanitized (DOMPurify); 1 removed with dead code | `lib/sanitize.ts`; tsc/build green |
| FE-3 | Mobile navigation drawer (sidebar was desktop-only) | `Header.tsx` + shared `navConfig.ts`; build green |
| FE-4 | Stale search results cleared on error; retention thresholds + category maps aligned to backend | tsc/lint/build green |
| FE-5 | Dead components removed (ChunkCard, Card3D, AnimatedBackground) | grep + build confirm no dangling refs |
| Ops | CI workflow, Dockerfile, `requirements-test.txt`, `.env.example` + README updated | files added; commands mirror locally-verified ones |

## 3. What remains BROKEN / OPEN (FAIL)

- **P0-3 — Multi-worker quiz scoring.** `_session_store` is in-process; >1 worker breaks scoring. Hardened the trust model (P0-4) but not the store. **Fix = persist the answer key (DB/Redis).** (CHALLENGE C-1, QA #21.)
- **Full `requirements.txt` won't install on Python 3.14** (`torch==2.5.1+cpu` has no cp314 wheel). CI/Docker pin Python 3.12 to work around it; a real fix is bumping torch or pinning the interpreter. (QA #22.)
- **Dual-store (SQLite↔Chroma) writes still non-atomic** for ingest/delete (edit is fixed). No reconciliation job. (DATABASE_REVIEW D-3.)
- **Calendar reminders remain a client-side approximation**, not backend FSRS due dates. (UI_REVIEW D-2.)

## 4. What is UNVERIFIED (environmental limits — not claims of correctness)

- **All live ML paths**: real ingest, semantic search ranking, LLM classification, LLM quiz generation, and the *real* (non-stubbed) re-embed. The heavy stack (torch/sentence-transformers + a Groq key) was not installed/run; torch has no Python-3.14 wheel here. Logic is unit-tested in isolation and the wiring is test-covered, but the end-to-end runtime was not executed.
- **All frontend visual/interaction behavior** (mobile drawer rendering, sanitized markdown display, threshold colors): only `tsc`/`lint`/`build` were run — there was no browser.
- **CI and Docker**: modeled on the exact commands that passed locally, but not executed on GitHub Actions / a Docker daemon.

These must be exercised in staging before shipping. See `QA_REPORT.md` for the per-area PASS/FAIL/UNVERIFIED matrix.

## 5. Files changed

**New (19):** `intelligence/` package (`__init__`, `memory/{ebbinghaus,scheduler}`, `embeddings/provider`, `retrieval/vector_store`, `ranking/scoring`, `llm/{provider,categorization,quiz_generation}`, `domain/{chunking,complexity}`, `tests/`, `pyproject.toml`, `README.md`); `backend/observability.py`, `backend/ratelimit.py`, `backend/requirements-test.txt`, `backend/tests/test_p0_fixes.py`, `backend/tests/test_ratelimit.py`; `frontend/eslint.config.js`, `frontend/src/lib/sanitize.ts`, `frontend/src/components/layout/navConfig.ts`; `Dockerfile`, `.github/workflows/ci.yml`; 7 report markdowns.

**Modified (backend):** `main.py`, `routers/{auth,ai,chunks,quiz,review,search,ingest,seed,fading,stats,health,discovery,deps,_shared}.py`, `database/db.py`, `services/category_service.py`, `seed_demo_data.py`, `tests/{conftest,test_review_loop}.py`, `.env.example`.

**Deleted (moved into intelligence):** `backend/core/{__init__,decay_engine,embeddings,chunker,complexity}.py`, `backend/services/{chroma_service,llm_service,scheduler_service}.py`.

**Modified (frontend):** `Header.tsx`, `Sidebar.tsx`, `Dashboard.tsx`, `LibraryPage.tsx`, `NoteEditorPage.tsx`, `PomodoroPage.tsx`, `SearchPage.tsx`, `lib/api.ts`, `styles/theme.ts`, `package.json` (+lock). **Deleted:** `ChunkCard.tsx`, `Card3D.tsx`, `AnimatedBackground.tsx`. **Root:** `ReadMe.md`.

## 6. Database / storage changes
- Added `chroma_service.upsert_chunk` (now in `intelligence.retrieval`) and used it on edit (P0-1).
- Added `db.get_quiz_history`; `complete_quiz_session` gained a `user_id` scope and now actually gets called.
- `purge_expired_refresh_tokens` now invoked (refresh + startup).
- **No schema migration was applied** in this pass — the split-schema/no-Alembic problems are documented with a concrete migration path in `DATABASE_REVIEW.md` (deferred because it needs a live DB to validate; doing it half-way would be worse).

## 7. Migration notes
- **Email case:** before deploying P1 email normalization to an existing DB, run `UPDATE users SET email = lower(email);` (CHALLENGE C-6).
- **CORS:** set `CORS_ORIGIN_REGEX` explicitly in production (default no longer allows public IPs).
- **Python:** deploy on 3.12 (Dockerfile/CI do) until torch is bumped.
- **New env vars:** `LOG_LEVEL`, `DORY_RATE_LIMIT_PER_MIN`, `DORY_CHROMA_PATH` (documented in `backend/.env.example`).
- **Postgres path** (when scaling past one node): SQLAlchemy + Alembic, `ON DELETE CASCADE`, request-scoped sessions, optional pgvector — full steps in `DATABASE_REVIEW.md §5`.

## 8. Validation results (final, captured)
```
backend/tests   : 34 passed
intelligence/tests : 11 passed         (total 45 passed)
frontend tsc    : PASS (exit 0)
frontend lint   : PASS (exit 0, --max-warnings 0)   # was BROKEN at baseline
frontend build  : PASS (exit 0)
import main     : PASS (Dory.md API 1.0.0; /livez,/readyz,/api/quiz/history present)
```

## 9. Remaining risks (ranked)
1. **Multi-worker quiz scoring (P0-3)** — silent wrong scores under any horizontal deploy. Fix before scaling.
2. **Runtime-unverified intelligence paths** — ingest/search/classify/real-reembed proven only in isolation; validate in staging with the real ML stack + a Groq key.
3. **Data durability** — SQLite + Chroma on local disk, no backups, non-atomic dual writes; on ephemeral hosts data is lost on redeploy.
4. **No billing/quota** on the paid LLM (rate limit caps frequency, not spend per user).
5. **Frontend unproven in a browser** — mobile nav and sanitization need a visual smoke test.
6. **No Alembic** — schema evolution is still hand-rolled.

## 10. Recommended next actions (sequenced)
1. Persist the quiz answer key (DB/Redis) → close P0-3; add a multi-worker test.
2. Stand up staging with Python 3.12 + full ML stack + Groq key; run the UNVERIFIED matrix (QA §2 rows 9,17–20) and a browser smoke of the frontend.
3. Adopt Alembic; consolidate `schema.sql`; add `ON DELETE CASCADE`; run the email-lowercase migration.
4. Add managed Postgres + backups (and evaluate pgvector to make ingest/edit/delete atomic).
5. Add per-user LLM quotas + basic usage metrics; then billing.
6. Privacy policy / ToS / data-export / delete-account for legal readiness.
7. Finish the a11y pass (focus traps, contrast audit) and lazy-load `mammoth` (499 KB) to trim the bundle.

---

*No step here was reported as complete without a command output or file to back it. The boundary between "verified" and "unverified" is drawn deliberately and is the most important line in this report.*
