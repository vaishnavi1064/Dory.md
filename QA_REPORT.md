# Dory.md — QA & Product Validation (Agent 6)

**Date:** 2026-06-01
**Verdicts:** PASS / FAIL / UNVERIFIED only. UNVERIFIED = could not be executed in this environment (no live ML stack, no browser, no GH Actions/Docker). No guessing.

**Environment:** Python 3.14.5 venv with the test-dependency subset (torch/sentence-transformers intentionally absent; tests skip warm-up). Node 22.22.3 (downloaded locally; not preinstalled). Verdicts reflect the **final** state after all changes.

---

## 1. Automated gates (final run, captured)

| Gate | Command | Result | Verdict |
|---|---|---|---|
| Backend unit/integration tests | `pytest backend/tests/ -q` | 34 passed | **PASS** |
| Intelligence unit tests | `pytest intelligence/tests/ -q` | 11 passed | **PASS** |
| Frontend typecheck | `tsc --noEmit` | exit 0 | **PASS** |
| Frontend lint (strict) | `npm run lint` (`--max-warnings 0`) | exit 0 | **PASS** |
| Frontend prod build | `vite build` | exit 0 | **PASS** |
| App import (uvicorn-equivalent) | `import main` from `backend/` cwd | `Dory.md API 1.0.0`, livez/readyz/quiz-history present | **PASS** |

Total automated tests: **45 passing** (was 27 at baseline; README had claimed "17").

---

## 2. Functional areas

| # | Area | What was checked | Verdict | Evidence / note |
|---|---|---|---|---|
| 1 | Backend startup | lifespan import, router wiring, fail-fast secret guard | **PASS** | `import main` OK; `require_secret_configured` no-ops in dev |
| 2 | Auth: register | success + duplicate + short pwd/name + **bad email rejected** | **PASS** | `test_auth` + new email validator (field_validator) |
| 3 | Auth: login | correct/wrong password | **PASS** | `test_login_*` |
| 4 | Auth: refresh rotation | rotates, old revoked, new works | **PASS** | `test_refresh_rotates_token` |
| 5 | Auth: logout | refresh revoked after logout | **PASS** | `test_logout_revokes_refresh_token` |
| 6 | Token-type enforcement | refresh token rejected where access expected | **PASS** | `test_access_token_with_wrong_type_rejected` |
| 7 | Per-user isolation (CRUD) | read/update/delete/folder/review/bulk cross-user → 404/scoped | **PASS** | 6 `test_chunk_authz` cases |
| 8 | FSRS review loop | grade Again/Easy/Good, due advances in DB, invalid grade, queue isolation, auth | **PASS** | 9 `test_review_loop` cases |
| 9 | Chunk edit re-index (P0-1) | PUT re-embeds + upserts vector w/ owner; cross-user edit skips reindex | **PASS (wiring)** / **UNVERIFIED (real model)** | `test_edit_reembeds_chunk` w/ stubbed embedder; real torch path not run (CHALLENGE C-2) |
| 10 | Quiz session completion (P0-2) | submit marks session completed; history endpoint returns it; auth required | **PASS** | `test_submitting_quiz_records_completed_session`, `test_quiz_history_*` |
| 11 | Quiz server-authoritative scoring (P0-4) | forged `correct_index` ignored; server value used | **PASS** | `test_quiz_answer_ignores_client_supplied_correct_index` |
| 12 | Refresh-token purge (P0-5) | called on refresh + at startup | **PASS (wiring)** | wired in `auth.refresh` + lifespan; growth-over-time not time-simulated |
| 13 | Rate limiting (P1-2) | 429 past threshold; inert in dev | **PASS** | `test_rate_limit_blocks_after_threshold`, `test_rate_limit_inert_in_dev` |
| 14 | AI endpoints auth gate | summarize/expand/optimize require auth | **PASS** | `test_ai_auth` (3) |
| 15 | Liveness/readiness probes | `/livez`, `/readyz` present | **PASS (presence)** / **UNVERIFIED (db-down 503 path)** | routes exist; 503 branch not fault-injected |
| 16 | Structured logging | logging configured, request-id middleware | **PASS (wiring)** / **UNVERIFIED (output format)** | tests pass with middleware active; log lines not asserted |
| 17 | Ingest (file/text) | parse → chunk → embed → store → classify(bg) | **UNVERIFIED (runtime)** | needs real embedding model + Chroma; logic unchanged, only re-pointed to intelligence |
| 18 | Search ranking | embed query, vector query, composite rank | **UNVERIFIED (runtime)** | needs real model + Chroma; ranking math unit-tested in isolation (`test_intelligence`) |
| 19 | Category classification | LLM classify + persist | **UNVERIFIED (runtime)** | needs LLM key; pure `classify` path not run, taxonomy unified & validated by code |
| 20 | Time Machine `/health` projection | batch retention | **PASS (math)** / **UNVERIFIED (endpoint live)** | `calculate_retention_batch` matches scalar in `test_intelligence` |
| 21 | Multi-worker quiz scoring | survives >1 worker | **FAIL** | in-memory store, see CHALLENGE C-1 / AUDIT P0-3 — OPEN |
| 22 | Full `requirements.txt` install | `pip install -r requirements.txt` | **FAIL (Py 3.14)** | torch==2.5.1+cpu has no cp314 wheel; CI/Docker pin 3.12 |

## 3. Frontend (build-verified, not run-verified)

| # | Area | Verdict | Note |
|---|---|---|---|
| 23 | Typecheck/lint/build | **PASS** | see §1 |
| 24 | XSS sanitization (DOMPurify) | **PASS (code)** / **UNVERIFIED (runtime)** | all 3 `dangerouslySetInnerHTML` sinks now sanitized (one removed with dead `ChunkCard`) |
| 25 | Mobile navigation drawer | **PASS (build)** / **UNVERIFIED (runtime)** | new drawer in Header; no browser to confirm rendering/interaction |
| 26 | Stale-results-on-error cleared | **PASS (code)** / **UNVERIFIED (runtime)** | SearchPage clears results on catch |
| 27 | Category color/emoji taxonomy | **PASS (code)** | theme + Dashboard maps extended to real backend categories |
| 28 | Retention threshold alignment | **PASS (code)** | frontend 0.8/0.5/0.2 mirrors backend |
| 29 | Dead code removed | **PASS** | ChunkCard/Card3D/AnimatedBackground deleted; no dangling imports (grep + build) |
| 30 | Accessibility (aria on bell, dialog roles) | **PARTIAL / UNVERIFIED** | added some aria/labels + `role=dialog`; full a11y audit (focus trap everywhere, contrast) not run |

## 4. Infra artifacts

| # | Artifact | Verdict | Note |
|---|---|---|---|
| 31 | `.github/workflows/ci.yml` | **UNVERIFIED (runtime)** | mirrors locally-verified commands; not executed on GH Actions |
| 32 | `Dockerfile` | **UNVERIFIED (runtime)** | no Docker daemon here; conventional, copies backend+intelligence |
| 33 | `requirements-test.txt` | **PASS** | exactly the set that produced 45 passing tests |

---

## 5. Summary
- **PASS:** all 45 automated tests, app import, lint/build/typecheck, every previously-tested behavior (no regression), plus the new P0-2/P0-4/P0-5/rate-limit/email gates.
- **FAIL (known, documented):** multi-worker quiz scoring (P0-3, OPEN); full `requirements.txt` install on Python 3.14.
- **UNVERIFIED (environmental):** all live ML paths (ingest/search/classify/real re-embed), all browser/visual behavior, CI and Docker execution. These are limits of this sandbox, not evidence of correctness — they must be exercised in a staging environment before release.
