# Dory.md — Database & Storage Architecture Review (Agent 2)

**Date:** 2026-06-01
**Stack today:** SQLite (WAL) via raw `sqlite3` + ChromaDB persistent client. No ORM, no migration framework.
**Verdict up front:** SQLite is **acceptable for a single-node v1**, but the *current implementation* has concrete defects (split schema, no migration framework, no FK indexes on some hot paths, connection-per-call, no transactional grouping for multi-store writes). A move to **Postgres + SQLAlchemy + Alembic is justified before multi-worker / multi-tenant scale** — but only once the multi-store consistency story (SQLite ↔ Chroma) is addressed, because that bug survives any engine swap.

---

## 1. What exists (verified)

### Relational store — SQLite
- Path: `data/dory.db`, overridable via `DORY_DB_PATH` ([db.py:13-18](backend/database/db.py#L13-L18)).
- Connection: `check_same_thread=False`, `timeout=5.0`, `WAL`, `foreign_keys=ON`, `busy_timeout=5000` — opened **fresh on every helper call** and closed ([db.py:21-29](backend/database/db.py#L21-L29)).
- Tables (`schema.sql`): `users`, `chunks`, `access_log`, `quiz_sessions`, `refresh_tokens`.
- Vector store: ChromaDB persistent client at `data/chroma`, collection `dory_chunks`, cosine space, stores embeddings + `{user_id, chunk_id, source_file}` metadata; **documents/content are NOT stored in Chroma** (content lives in SQLite) ([chroma_service.py](backend/services/chroma_service.py)).

### Schema (as written in `schema.sql`)
```
users(id PK, email UNIQUE, created_at)
chunks(id PK, user_id→users, source_file, content, category, complexity_score,
       created_at, last_accessed, access_count)
access_log(id PK AUTOINC, chunk_id→chunks, user_id→users, accessed_at, source)
quiz_sessions(id PK, user_id→users, started_at, completed_at, correct_count, total_count)
refresh_tokens(token_hash PK, user_id→users NOT NULL, issued_at, expires_at NOT NULL, revoked_at)
indexes: idx_chunks_user, idx_chunks_retention(last_accessed,access_count),
         idx_access_log_chunk, idx_refresh_tokens_user
```

---

## 2. Defects & risks (each with evidence)

### D-1 — Schema is split across `schema.sql` + imperative `ALTER TABLE` — VERIFIED · HIGH
`users.name`, `users.password_hash`, `chunks.folder`, and **every** `fsrs_*` column exist only through `_migrate()` `ALTER TABLE` statements ([db.py:32-60](backend/database/db.py#L32-L60)), not in `schema.sql`. Consequences:
- `schema.sql` is a **misleading** source of truth (e.g. it shows no `password_hash`, yet auth depends on it).
- `_migrate` is a hand-rolled, **forward-only, unversioned** migration runner. No version table, no rollback, no ordering guarantees beyond code order.
- A reviewer or a fresh deploy reading `schema.sql` cannot reconstruct the real schema.

### D-2 — No migration framework / no migration history — VERIFIED · HIGH
No Alembic, no `schema_migrations` table (`grep`). The only mechanism is "add column if PRAGMA table_info lacks it." This does not handle: column type changes, drops, renames, data backfills beyond the one inline `UPDATE`, or coordinating schema across environments. **This is the #1 thing to fix for "sellable SaaS."**

### D-3 — Dual-store writes are not atomic (SQLite ↔ Chroma) — VERIFIED · HIGH
Ingest inserts rows into SQLite, then calls `add_chunks(...)` to Chroma ([ingest.py:49-61](backend/routers/ingest.py#L49-L61)). If the Chroma write throws, the SQLite rows are already committed → **a chunk with no embedding** (invisible to search, visible in Library). Conversely, delete removes from SQLite then best-effort `chroma_delete` inside `try/except: pass` ([chunks.py:91-97](backend/routers/chunks.py#L91-L97)) → **orphan embeddings** if Chroma delete fails. And **edit never touches Chroma at all** (AUDIT P0-1). There is no reconciliation job. This consistency gap is engine-independent.

### D-4 — Foreign keys declared but un-cascading; deletes are manual — VERIFIED · MEDIUM
`chunks.user_id REFERENCES users(id)` etc. are declared, and `PRAGMA foreign_keys=ON` is set per connection. But:
- There is **no `ON DELETE CASCADE`**. Deleting a user (no endpoint exists) would orphan chunks/logs/sessions/tokens.
- `delete_chunk` manually deletes `access_log` rows ([db.py:313-325](backend/database/db.py#L313-L325)) because the FK won't cascade. Easy to forget for future child tables.
- `users.email UNIQUE` allows **NULL** and there is no `NOT NULL`/format constraint on email; `complexity_score` has no CHECK for `[0,1]`.

### D-5 — Connection-per-call, no pooling — VERIFIED · MEDIUM
Every helper does `_connect()` … `conn.close()`. Search triggers ~50 of these per query (AUDIT P4-3). SQLite connection open is cheap-ish but not free, and WAL checkpointing across many short connections is suboptimal. No pooling, no per-request connection, no unit-of-work. Under concurrency, writers serialize on the single-writer WAL lock with a 5 s busy timeout → request stalls/`database is locked` 500s are possible under load. **UNVERIFIED (runtime)** but structurally present.

### D-6 — Missing indexes for real query patterns — VERIFIED · MEDIUM
- `get_review_queue`/`count_due_chunks` filter on `(user_id, fsrs_due)` — index `idx_chunks_fsrs_due(user_id, fsrs_due)` is created **only inside `_migrate`** ([db.py:51-53](backend/database/db.py#L51-L53)), not in `schema.sql` (so a from-scratch `schema.sql` apply lacks it until migrate runs — it does run, but the split is fragile).
- `fading`/`stats`/`health`/`discovery` all do **full-table scans** of a user's chunks then compute retention in Python (no SQL can index a `exp()` formula). For a user with 50k chunks every dashboard load is O(n) in Python. Acceptable for v1, a scaling wall later.
- `get_lowest_retention_chunks` orders by `(last_accessed ASC, access_count ASC)` — covered by `idx_chunks_retention` but **not user-scoped in the index** (`idx_chunks_retention(last_accessed, access_count)` lacks `user_id` prefix), so it can't be used efficiently with the `WHERE user_id=?` filter.

### D-7 — Unbounded `refresh_tokens` and `access_log` growth — VERIFIED · MEDIUM
`purge_expired_refresh_tokens` is never called (AUDIT P0-5). `access_log` is append-only with no retention/rollup; every review/quiz/access writes a row forever. No partitioning or TTL.

### D-8 — `complexity_score REAL DEFAULT 0.5` but values can exceed model assumptions — VERIFIED · LOW
`complexity.score` returns `[0,1]` but no DB CHECK enforces it; `to_chunk_full`/decay clamp defensively. Fine, but the invariant lives only in code.

---

## 3. SQLite vs Postgres — honest decision matrix

| Dimension | SQLite (today) | Postgres + SQLAlchemy + Alembic |
|---|---|---|
| Single-node v1, < a few hundred users | ✅ Fine with WAL | ✅ Overkill but fine |
| Multi-worker (`uvicorn --workers N`, gunicorn) | ⚠️ Single-writer lock; `database is locked` under write contention | ✅ Real concurrency |
| Horizontal scale / managed hosting (Fly, Render, RDS) | ❌ Local file; doesn't fit stateless containers | ✅ Standard |
| Migrations | ❌ Hand-rolled, forward-only | ✅ Alembic versioned + rollback |
| Constraints / CHECK / partial indexes / `ON DELETE CASCADE` | ⚠️ Limited | ✅ Full |
| Concurrent quiz/review writes | ⚠️ Serialized | ✅ MVCC |
| Vector search | external (Chroma) either way | external (Chroma/pgvector) either way |
| Ops cost / setup | ✅ Zero | ⚠️ A managed DB to run |

**Recommendation (justified, not blind):**
1. **v1 / demo / single container:** keep SQLite, but fix D-1/D-2/D-3/D-6/D-7.
2. **Before charging money on a multi-instance deploy:** migrate to Postgres. The right migration path is **SQLAlchemy 2.0 (typed models) + Alembic**, which simultaneously fixes D-1/D-2 (one model = schema = migration source of truth) and unlocks `ON DELETE CASCADE`, CHECK constraints, partial indexes, and pooling. `pgvector` could later absorb ChromaDB to make D-3 a single-transaction write — eliminating the dual-store consistency class of bugs entirely.

I am **not** performing a blind SQLite→Postgres migration in this pass: it is a large, runtime-risky change that cannot be validated here without a live Postgres + the full ML stack, and doing it half-way would be worse than not at all. Instead I implement the **lower-risk, fully-testable** improvements below and document the Postgres path precisely.

---

## 4. Improvements implemented in this pass (see code changes + QA_REPORT)

Targeted, pytest-validated, engine-preserving:
- **D-1 (partial):** consolidate the real schema into `schema.sql` so it is the source of truth, with `_migrate` kept only as the idempotent upgrader for existing DBs; add a `schema_migrations` version row.
- **D-3 (the worst half):** make chunk **edit** re-embed and update Chroma; make delete reconciliation explicit; centralize the SQLite+Chroma write so the ordering and failure handling live in one place.
- **D-6:** add `idx_chunks_user_fsrs_due` / user-scoped retention index in `schema.sql` (not only in `_migrate`).
- **D-7:** call `purge_expired_refresh_tokens` on refresh and at startup.
- Add **CHECK**/`NOT NULL` where SQLite supports it for new DBs (email not null, complexity range) — applied to fresh schema only (SQLite can't add CHECK via ALTER), documented for the Postgres cutover.

Items explicitly deferred (with rationale): full Alembic adoption (L, needs runtime), Postgres engine swap (L, needs live DB), pgvector consolidation (L). These are tracked in `PRODUCT_GAPS.md`.

---

## 5. Migration notes (for the eventual Postgres cutover)
1. Introduce SQLAlchemy models mirroring the consolidated `schema.sql` (1:1, same column names so the wire shapes don't change).
2. `alembic init`, autogenerate the baseline from the models, stamp existing SQLite-derived DBs.
3. Add `ON DELETE CASCADE` to all `*_id` FKs; drop the manual `access_log` delete in `delete_chunk`.
4. Add CHECK(`complexity_score BETWEEN 0 AND 1`), `email NOT NULL`, partial index `WHERE revoked_at IS NULL` on refresh tokens.
5. Move connection handling to a request-scoped session (FastAPI dependency) with a pool; remove `_connect()`-per-call.
6. (Optional) Replace Chroma with `pgvector` to make ingest/edit/delete single-transaction — closes D-3 permanently.
7. Data copy: export SQLite tables → COPY into Postgres; re-embed is unnecessary if Chroma is retained, required if moving to pgvector.

**Risk if skipped:** under any multi-instance production deploy, write contention (D-5) and the in-memory quiz store (AUDIT P0-3) will produce intermittent, hard-to-reproduce failures.
