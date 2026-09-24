# BUILD.md — Decay-Aware Knowledge Graph for Dory.md

**Goal:** Add a knowledge graph on top of the existing chunk store where (a) related chunks are linked by semantic edges and (b) reviewing one chunk propagates a damped fraction of its stability gain to its neighbors ("spreading activation"). Because reinforcement flows through *stability*, it feeds the existing `decay_urgency` ranking term automatically — no change to the ranking formula is required.

This document is written to be executed by Claude Code. Work **top to bottom, one phase per commit.** Do not start a phase until the previous phase's "Definition of done" is fully green.

---

## 0. Read before you write (non-negotiable guardrails)

These reflect existing conventions in this repo. Violating them breaks tests or the architecture.

1. **Per-user isolation.** Every edge is scoped to `user_id`. Every query filters by the current authenticated user. An edge must **never** connect two users' chunks, and one user's review must **never** affect another user's stability. This is the single most important correctness property — add explicit tests for it.
2. **The `intelligence/` layer is pure.** It must not import from `backend`. There is an existing test that fails on such an import — keep it passing. All propagation *math* goes in `intelligence/`; all DB/HTTP/Chroma *plumbing* goes in `backend/`.
3. **Match the existing data layer.** `backend/database/db.py` uses raw `sqlite3`, not an ORM. Extend it in the same style.
4. **Match the existing theme and components.** Reuse the current retention-bucket color palette (strong/fading/weak/critical) and the existing "warm + lavender" theme. Reuse existing toast/animation and fetch/auth patterns (see `frontend/src/lib/mood.ts`, `frontend/src/lib/wellness.ts`). Do not introduce a new styling system.
5. **CI gates must pass before every commit:** backend `pytest`, intelligence `pytest` (including the no-backend-import test), and frontend `tsc` + `eslint --max-warnings 0` + `vite build`. These mirror `.github/workflows/ci.yml`.
6. **No inline `TODO`/`FIXME`/`HACK`.** This repo tracks open items in docs, not code comments. Keep it that way.

### Verify names first
Before applying any DDL or file path below, **read the actual schema and routes** and adjust to match. In particular:
- Confirm the real table names and primary-key types for users and chunks (the DDL below assumes tables `users` and `chunks` with integer PKs — correct them if they differ, e.g., UUID text keys).
- Confirm where reviews are recorded (assumed `backend/routers/quiz.py`) and what the FSRS update returns, so you can extract the stability gain (ΔS) for the reviewed chunk.
- Confirm how ChromaDB queries are filtered per user today, and reuse that exact mechanism for neighbor lookup.

**Files to read first:** `backend/database/db.py`, `intelligence/memory/ebbinghaus.py`, `intelligence/memory/scheduler.py`, `intelligence/ranking/scoring.py`, `backend/routers/quiz.py`, the ingest/chunk-creation path, `backend/routers/deps.py` (auth/current-user), `frontend/src/App.tsx` (routing), `frontend/src/lib/mood.ts` and `frontend/src/lib/wellness.ts` (client-lib patterns).

---

## 1. Config knobs

Add to the backend config/env layer with these defaults, and document them where other env vars are documented:

| Name | Default | Meaning |
|------|---------|---------|
| `SEMANTIC_EDGE_THRESHOLD` (τ) | `0.6` | Minimum cosine similarity for an auto-generated edge |
| `MAX_EDGES_PER_CHUNK` (K) | `8` | Cap on neighbors linked per chunk (bounds graph density) |
| `SPREAD_ALPHA` (α) | `0.3` | Global damping on propagated reinforcement (0..1) |

---

## 2. Data model

Add to the schema (adjust table/column names and PK types to match reality):

```sql
CREATE TABLE IF NOT EXISTS chunk_edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    source_id   INTEGER NOT NULL,   -- canonical ordering: source_id < target_id
    target_id   INTEGER NOT NULL,
    weight      REAL    NOT NULL,   -- 0..1; cosine similarity for edge_type='semantic'
    edge_type   TEXT    NOT NULL DEFAULT 'semantic',   -- 'semantic' | 'manual'
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)   REFERENCES users(id)  ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES chunks(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES chunks(id) ON DELETE CASCADE,
    UNIQUE (user_id, source_id, target_id),
    CHECK (source_id < target_id)
);
CREATE INDEX IF NOT EXISTS idx_chunk_edges_user_source ON chunk_edges(user_id, source_id);
CREATE INDEX IF NOT EXISTS idx_chunk_edges_user_target ON chunk_edges(user_id, target_id);
```

Edges are **undirected**, stored once with `source_id < target_id`. Traversal must consider a node's edges regardless of which column it appears in. Edges live only in SQLite; ChromaDB is *queried* for neighbor discovery but never written for edges — so this introduces **no new dual-write concern** (confirm this holds and note it in the PR).

---

## Phase 0 — Schema + pure propagation function

**Add**
- Migration/DDL for `chunk_edges` (Section 2), wired into the existing schema-init path in `db.py`.
- `intelligence/memory/spreading.py`:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Neighbor:
    chunk_id: int
    edge_weight: float        # 0..1
    current_stability: float

def propagate_reinforcement(
    reviewed_stability_gain: float,   # ΔS applied to the reviewed chunk by FSRS
    neighbors: list[Neighbor],
    alpha: float = 0.3,               # global damping, 0..1
    max_stability: float | None = None,
) -> dict[int, float]:
    """
    Single-hop spreading activation. Returns {chunk_id: new_stability}
    for neighbors that should be reinforced.

    new_stability = current_stability + reviewed_stability_gain * edge_weight * alpha
    then clamped to <= max_stability (when provided).

    Pure: imports nothing from `backend`. Never raises on empty input.
    """
```

**Tasks**
- [ ] Add and initialize the `chunk_edges` table.
- [ ] Implement `propagate_reinforcement` (single-hop only).
- [ ] Add unit tests in the intelligence test suite.

**Definition of done**
- [ ] Tests cover: empty neighbors → `{}`; single neighbor scales by `edge_weight * alpha`; multiple neighbors; clamp at `max_stability`; never returns a value below `current_stability`; deterministic for identical inputs.
- [ ] The no-backend-import boundary test still passes (add `spreading.py` to whatever that test scans if needed).
- [ ] Intelligence `pytest` green. **Commit.**

---

## Phase 1 — Semantic edge generation

**Add**
- `backend/core/graph_edges.py` — talks to ChromaDB + `db.py`, calls nothing from `intelligence` except plain types.
  - `generate_edges_for_chunk(user_id, chunk_id)`: query Chroma for the chunk's top `MAX_EDGES_PER_CHUNK + 1` nearest neighbors (exclude self), **filtered to this user**, keep those with similarity ≥ `SEMANTIC_EDGE_THRESHOLD`, insert canonical `(min, max)` edges, upsert `weight` on conflict.
  - `rebuild_edges_for_user(user_id)`: iterate the user's chunks and run the above; must be idempotent (the unique constraint + upsert guarantees no duplicates).
- Edge CRUD helpers in `db.py` (insert/upsert edge, list edges for user, list a chunk's neighbors, delete edge).

**Wire in**
- Call `generate_edges_for_chunk` at the end of the existing ingest/chunk-creation path, **after** the embedding is stored in Chroma.

**Tasks**
- [ ] Implement neighbor discovery + canonical insert/upsert.
- [ ] Hook edge generation into ingest.
- [ ] Backend tests.

**Definition of done**
- [ ] Tests cover: edges created on ingest above τ; nothing created below τ; density capped at K; rebuild is idempotent (running twice does not add rows or change count); **cross-user isolation — user A ingesting never creates an edge to user B's chunk.**
- [ ] Backend `pytest` green. **Commit.**

---

## Phase 2 — Reinforcement wiring (the actual feature)

**Wire in** (in the review/answer endpoint, likely `backend/routers/quiz.py`)
- After FSRS updates the reviewed chunk and you know its stability gain ΔS:
  1. Load the reviewed chunk's neighbors (edge weight + each neighbor's current stability) from `chunk_edges`, scoped to the user.
  2. Call `intelligence.memory.spreading.propagate_reinforcement(ΔS, neighbors, alpha=SPREAD_ALPHA, max_stability=...)`.
  3. Persist the returned `{chunk_id: new_stability}` back to the chunks table, in the **same transaction** as the review update, following the existing write/integrity discipline.
- Include a `reinforced_neighbor_count` (int) in the review endpoint's JSON response — the frontend toast in Phase 4 uses it.

**Tasks**
- [ ] Add the propagation call + persistence to the review flow.
- [ ] Return `reinforced_neighbor_count`.
- [ ] Backend tests.

**Definition of done**
- [ ] Tests cover: reviewing a chunk measurably raises a linked neighbor's stability by `ΔS * weight * α` (within tolerance); a chunk with no edges changes no neighbors; **isolation — the review never touches another user's chunk**; stability never exceeds the max clamp.
- [ ] Backend + intelligence `pytest` green. **Commit.**

---

## Phase 3 — Read API for the graph

**Add** `backend/routers/graph.py`:
- `GET /api/graph?bucket=<optional>&focus_chunk_id=<optional>&limit=<default 300>`
  → `{ nodes: [{ id, retention, bucket, label }], edges: [{ source, target, weight, type }] }`.
  Bound the payload: default `limit` on nodes; if `focus_chunk_id` is given, return only that node's neighborhood. All scoped to the current user.
- `GET /api/graph/chunk/{chunk_id}/neighbors`
  → `[{ chunk_id, weight, type, retention, bucket }]`.
- `POST /api/graph/rebuild` → `{ edges_created, edges_total }` (wraps `rebuild_edges_for_user`; for backfilling existing chunks).

Register the router with the app.

**Definition of done**
- [ ] Tests cover: response shapes; user only sees their own nodes/edges; `limit` respected; `focus_chunk_id` returns a bounded neighborhood; `rebuild` is idempotent via the endpoint.
- [ ] Backend `pytest` green. **Commit.**

---

## Phase 4 — Frontend graph view

**Dependency:** add `react-force-graph-2d` (canvas-based force-directed graph; handles hundreds of nodes). *Alternative if you'd rather not add a dep: use `d3-force` directly — more code, no new package.*

**Add**
- `frontend/src/lib/graph.ts` — types (`GraphNode`, `GraphEdge`) and `fetchGraph(params)`, `fetchNeighbors(chunkId)`, `rebuildGraph()`. Match the fetch/auth style in `mood.ts` / `wellness.ts`.
- `frontend/src/pages/GraphPage.tsx` — force-directed graph:
  - Node **color** = retention bucket, using the existing bucket palette.
  - Node **size** = degree (edge count).
  - Edge **opacity** ∝ `weight`.
  - Click a node → navigate to that chunk (or open a neighbor side-panel).
  - Loading state + empty state ("No connections yet — review or add notes to build your graph," with a button hitting `POST /api/graph/rebuild`).
  - Style with the existing warm + lavender theme.
- Route + nav entry — register `GraphPage` following the `App.tsx` routing pattern and add a nav item alongside the other pages.
- **Reinforced-neighbors toast** — after a review response with `reinforced_neighbor_count > 0`, show a brief toast: "Reviewing this also strengthened N related notes." Reuse the existing toast/animation setup.

**Definition of done**
- [ ] `tsc` clean, `eslint --max-warnings 0` clean, `vite build` succeeds.
- [ ] Graph renders from live data; nodes are bucket-colored; clicking navigates; empty state works. **Commit.**

---

## Phase 5 — Optional / stretch (only if you want to keep going)

Each is independent and separately commit-able:
- **Manual linking:** `POST /api/graph/edges {chunk_a, chunk_b}` (edge_type `manual`, weight `1.0`) and `DELETE /api/graph/edges/{id}`, plus a "link to…" affordance in the UI.
- **Multi-hop propagation:** extend `propagate_reinforcement` to distance `d` with activation `α^d · Π(edge weights)`, guarding against cycles. Keep single-hop as the default.
- **Mini-graph on a chunk detail view:** show a chunk's immediate neighbors inline.
- **Graph-aware ranking signal:** experiment with adding a small connectivity/centrality term to `scoring.py` (measure before shipping — the current 0.4/0.4/0.2 split is the baseline to beat).

---

## Final acceptance checklist

- [ ] Backend `pytest` green.
- [ ] Intelligence `pytest` green, including the no-backend-import boundary test.
- [ ] Frontend `tsc` + `eslint --max-warnings 0` + `vite build` green.
- [ ] Per-user isolation verified by explicit tests at every layer (edges, propagation, endpoints).
- [ ] No new inline `TODO`/`FIXME`/`HACK`.
- [ ] One commit per phase, each at a clean, green boundary.
