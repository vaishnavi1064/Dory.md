# Dory.md — Adversarial Review (Agent 5)

**Date:** 2026-06-01
**Stance:** Assume every change in this pass is wrong until proven otherwise. Hunt for regressions, incomplete fixes, false claims, and risk introduced by the changes themselves.

**Bottom line:** the changes are validated by the test suites (45 passing) and the frontend gates (tsc/lint/build), and the **original 27 tests still pass → no regression in previously-tested behavior**. BUT several fixes are verified only at the *wiring* level (mocked), several real runtime paths could not be executed here, and **one P0 was deliberately only half-fixed**. Details below, with no varnish.

---

## 1. Incomplete fixes (called out honestly)

### C-1 — P0-3 (multi-worker quiz store) is NOT fixed
I hardened P0-4 (the client-trusted scoring of `/quiz/answer`) but the underlying **in-memory `_session_store`** ([quiz.py:28]) is unchanged. Under `uvicorn --workers >1`, gunicorn, or any autoscaler, `/quiz/start` and `/quiz/{id}/submit` can hit different processes → empty session map → wrong scores. My change even *added* `_session_store.pop(session_id)` after submit, which is correct for single-process memory hygiene but does nothing for multi-process. **Status: OPEN.** Real fix = persist the answer key (DB/Redis). Tracked in PRODUCT_GAPS.

### C-2 — P0-1 (re-embed on edit) verified only with a STUBBED embedder
The test (`test_edit_reembeds_chunk`) monkeypatches `embed_query` and `chroma_upsert` and asserts the wiring. The **real** SentenceTransformer + ChromaDB `upsert` path was never executed (torch/sentence-transformers intentionally not installed; Python 3.14 has no torch wheel). So: "the PUT handler calls the indexer with the right args and owner metadata" is VERIFIED; "the real 384-dim vector is recomputed and the ANN index updates" is **UNVERIFIED (runtime)**. The logic mirrors the proven ingest path, so confidence is high, but it is not proof.

### C-3 — Dual-store consistency only half-closed
Edit now re-embeds (good), but **ingest and delete remain non-atomic** across SQLite↔Chroma (DATABASE_REVIEW D-3). A Chroma failure mid-ingest still yields a chunk with no vector; a failed Chroma delete still orphans a vector (now at least logged, not silently `pass`-ed). The consistency *class* of bug is not eliminated — only the worst instance (edit) plus observability.

### C-4 — Calendar/Dashboard still use a client-side decay approximation
I aligned the **bucket thresholds** (0.8/0.5/0.2) across backend and frontend (UI_REVIEW D-1), but the Calendar's `predictForgetDate` and `projectRetention` are still local approximations, not the backend FSRS `fsrs_due` (UI_REVIEW D-2). Numbers can still diverge from server truth. Not a regression — pre-existing and out of this pass's scope.

---

## 2. Regressions / behavior changes introduced by my changes

### C-5 — CORS default is now stricter (intentional, but a behavior change)
The default `CORS_ORIGIN_REGEX` no longer matches arbitrary public IPs — only localhost, RFC-1918 private ranges, and `*.vercel.app`. **If an existing deployment relied on browser access via a raw public IP, that origin is now blocked** until `CORS_ORIGIN_REGEX` is set explicitly. This is more secure and documented in `.env.example`, but it *is* a deploy-affecting change. Verdict: acceptable, flagged.

### C-6 — Email is now lowercased + format-validated on register/login
`register` rejects malformed emails and stores lowercased; `login` lowercases input. **Risk:** any pre-existing account created with a mixed-case email (before this change) would now fail to log in (input lowercased, stored value not). The only seeded account (`demo@dory.md`) is already lowercase, and the test users are lowercase, so the suite is unaffected — but a real existing DB could have mixed-case rows. **Mitigation needed before prod:** a one-time `UPDATE users SET email=lower(email)`. Flagged.

### C-7 — `update_chunk` response shape changed
`PUT /chunks/{id}` now returns `{"updated", "reindexed"}` instead of `{"updated"}`. The frontend ignores the body (`updateChunk` returns `void`), so no break — but any external API client keying off the exact shape would see a new field. Additive, low risk.

### C-8 — quiz `complete_quiz_session` writes on every submit
If a client submits the same `session_id` twice, the session is re-completed (idempotent UPDATE) and a duplicate would *not* be created, but `_session_store.pop` means the second submit scores 0 (session key gone). Minor; the frontend submits once.

---

## 3. Claims audited for honesty

| Claim made | Real status | Evidence |
|---|---|---|
| "27 → 45 tests pass" | TRUE | full `pytest` output captured both runs |
| "lint was broken, now passes" | TRUE | ESLint v9 "couldn't find config" → after `eslint.config.js`, `npm run lint` exits 0 with `--max-warnings 0` |
| "intelligence layer has no backend imports" | TRUE | enforced by AST test `test_intelligence_does_not_import_backend` (passing) |
| "re-embed on edit works" | PARTIAL | wiring verified with stub; real model path UNVERIFIED (runtime) |
| "rate limiting protects prod" | PARTIAL | mechanism verified via forced-on test; real `DORY_ENV!=dev` runtime behavior UNVERIFIED |
| "app boots" | TRUE (import) | `import main` from backend cwd succeeds; full `uvicorn` serving with ML stack UNVERIFIED |
| "frontend UI improvements work" | UNVERIFIED (runtime) | no browser/live env; only tsc/lint/build proven. Mobile drawer, sanitization visual, threshold colors NOT visually confirmed |

---

## 4. Things I could not test at all here (environmental)
- **No live backend run** with torch + sentence-transformers + ChromaDB + a Groq key (heavy stack; torch has no Python-3.14 wheel on this box). So: real ingest, real search ranking, real quiz LLM generation, real classification, real embedding re-index — all **UNVERIFIED (runtime)**.
- **No browser** → every visual/interaction claim in UI_REVIEW/this pass is **UNVERIFIED (runtime)**; only the build/typecheck/lint gates are proven.
- **No GitHub Actions / Docker daemon** → the new `ci.yml` and `Dockerfile` are modeled on the exact commands that passed locally but are **UNVERIFIED (runtime)**.
- **Full `backend/requirements.txt` still does not install on Python 3.14** (torch pin). Unchanged by design; CI/Docker pin Python 3.12 to sidestep it.

---

## 5. Over-engineering check (was the intelligence refactor worth it?)
The refactor is invasive (touched ~15 backend files). Risk of "architecture for its own sake." Counter-evidence it earned its keep: it surfaced and fixed real leakage (classification did a DB write from inside the "AI" module), it enabled a 0.1s pure test suite with a machine-enforced boundary, and it left the backend genuinely thinner. Residual coupling is documented (vector-store default path; FSRS row-key vocabulary). Verdict: justified, not gratuitous — but it is the single largest source of *untested-at-runtime* surface in this pass, so the passing import + 45 tests are load-bearing for confidence.

## 6. Net assessment
No detected regression in tested behavior. The highest residual risks are: **(a) C-1 multi-worker quiz scoring still broken**, **(b) C-2/C-4 runtime-unverified intelligence paths**, **(c) C-6 email-case migration**, **(d) the entire frontend is build-verified but not run-verified**. None of these are hidden — they are the honest edge of what could be proven in this environment.
