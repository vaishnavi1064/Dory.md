# Dory.md — Product Gap Analysis (Agent 7)

**Date:** 2026-06-01
**Lens:** founder / staff engineer / security reviewer / DevOps / platform architect.
**Rule:** every gap is tied to evidence in the repo (or its absence, verified by `find`/`grep`).

This is a strong **demo / portfolio** application with real ML-backed features. To be a **sellable SaaS** it is missing the operational, security, and trust layer. Below is what's missing, grouped, each with a verdict.

---

## 1. Deployment & build reproducibility — NOT READY
- **No CI pipeline.** `find .github` → none. Tests exist (27, passing) but nothing runs them on push. VERIFIED.
- **No backend container.** No `Dockerfile`/`docker-compose`. Only `backend/Procfile` (Heroku-style) and `frontend/vercel.json`. The ML stack (torch, sentence-transformers, chromadb) makes "works on my machine" risk high. VERIFIED.
- **Dependency pinning is unsafe.** `requirements.txt` pins only `torch==2.5.1+cpu`; everything else floats ([backend/requirements.txt](backend/requirements.txt)). No lockfile (no `uv.lock`/`poetry.lock`). Frontend has `package-lock.json` (good). VERIFIED.
- **Python version trap.** `torch==2.5.1+cpu` has **no Python 3.14 wheel**; this machine runs 3.14.5, so `pip install -r requirements.txt` fails. Pin a supported interpreter (3.11/3.12) in a `.python-version`/Docker base, or bump torch. VERIFIED.
- **Lint is broken** (ESLint 9 needs `eslint.config.js`, absent). A "build" that can't lint blocks any quality gate. VERIFIED.

## 2. Observability — ABSENT
- No logging anywhere (`grep logging/logger` → nothing). No request IDs, no error tracking (no Sentry), no metrics, no tracing. VERIFIED.
- `except Exception: pass` in delete/classify paths ([chunks.py:95], [category_service.py:37]) makes failures invisible.
- No `/livez`/`/readyz`. `GET /` is a static OK; `/api/health` is the Time Machine, not infra health (AUDIT P1-8). You cannot wire a real load-balancer health check.

## 3. Security & privacy — PARTIAL
- **Auth fundamentals are decent**: bcrypt hashing, JWT access+refresh with rotation + revocation, per-user data isolation enforced and **tested** (12 authz/review tests). VERIFIED — this is the strongest area.
- Gaps (all VERIFIED): no rate limiting (brute-force/credential-stuffing + unbounded LLM spend), permissive default CORS, `localStorage` tokens + unsanitized HTML (XSS→token theft), prod `JWT_SECRET` fails per-request not at boot, no email verification/format check, no password-reset flow, no account deletion / data export (GDPR/CCPA "right to access/erase" — there is literally no DELETE-user path), no audit log of security events.
- **Secrets handling:** `.env.example` is good; but the dev fallback JWT secret is a real string in code ([deps.py:18]) — fine for dev, must never be reachable in prod (it is gated by `DORY_ENV`).

## 4. Data durability & backup — NOT READY
- SQLite file + Chroma dir on local disk; **no backup/restore story, no PITR** (see `DATABASE_REVIEW.md`). On ephemeral container filesystems (Fly/Render/Heroku) **data is lost on redeploy**. VERIFIED.
- Dual-store (SQLite ↔ Chroma) has no reconciliation and non-atomic writes (DB review D-3) → drift accumulates with no repair tool.
- `refresh_tokens` and `access_log` grow unbounded (AUDIT P0-5, DB D-7).

## 5. Multi-tenancy & scale — SINGLE-NODE ONLY
- In-memory quiz session store ([quiz.py:26]) and LLM/embedding singletons assume **one process**. `uvicorn --workers >1` or any autoscaler breaks quiz scoring (AUDIT P0-3). VERIFIED.
- SQLite single-writer lock serializes writes (DB D-5). No horizontal scaling path without the Postgres migration.
- Embedding model is loaded in-process (CPU) — every replica holds ~90 MB model + torch; cold starts are slow. No shared embedding service.

## 6. Admin & support tooling — ABSENT
- No admin view, no user management, no usage dashboard, no feature flags, no way to inspect/repair a user's data. VERIFIED (no such routes/pages).

## 7. Monetization readiness — ABSENT
- No billing/subscription, no plan/quota enforcement, no usage metering (esp. for the paid LLM calls). The product can't charge or cap anyone today. VERIFIED.

## 8. Legal / compliance — ABSENT
- No Privacy Policy, ToS, cookie/consent, or data-processing notice in the repo. Client-side encryption exists for notes but with **no key recovery** ([NoteDetailPanel.tsx:18-47]) — a support/ύχsupportability and data-loss liability. No data-export or delete-account = not GDPR/CCPA-ready. VERIFIED.

## 9. Docs & onboarding — PARTIAL
- README is thorough for local dev but **drifted** (27 vs "17" tests; Windows-only commands; model-name mismatches). No architecture doc, no API reference (FastAPI gives `/docs` for free though), no runbook, no `CONTRIBUTING`. VERIFIED.
- No in-product onboarding beyond "Settings → Load demo data."

## 10. Reliability — PARTIAL
- `ErrorBoundary` on the frontend (good). But background tasks (classifier thread at startup, BackgroundTasks for classify) have no retry/dead-letter; failures vanish (no logging). No timeouts on outbound LLM calls ([llm_service.py] uses default client timeouts). VERIFIED.

---

## Readiness scorecard

| Area | Verdict |
|---|---|
| Core features (ingest/search/review/quiz/decay) | **Working** (with the correctness bugs in AUDIT) |
| AuthN/AuthZ correctness | **Strong & tested** |
| Observability | **Absent** |
| Deploy/CI/containers | **Not ready** |
| Data durability/backup | **Not ready** |
| Multi-node scale | **Single-node only** |
| Security hardening (rate limit, XSS, CORS, secrets-at-boot) | **Partial** |
| Billing/quotas | **Absent** |
| Legal/privacy/GDPR | **Absent** |
| Admin/support tooling | **Absent** |

## Recommended sequencing to "sellable v1"
1. **Close correctness P0s** (AUDIT P0-1..5) — this pass.
2. **Hardening**: logging, rate limiting, CORS allow-list, sanitize HTML, fail-fast secret, lint config, Dockerfile, CI. — partly this pass; rest tracked.
3. **Durability**: Postgres + Alembic + managed backups; reconcile dual-store or move to pgvector.
4. **Trust layer**: privacy policy/ToS, data export + delete-account, email verification, password reset.
5. **Commercial**: plans, quotas (esp. LLM), billing, admin console, basic metrics dashboard.
