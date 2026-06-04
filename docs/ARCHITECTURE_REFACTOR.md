# Dory.md — Architecture Refactor: Intelligence Layer Extraction (Agent 2B)

**Date:** 2026-06-01
**Goal:** Enforce strict separation of concerns by extracting all business/memory-science/AI logic into an independent top-level `intelligence/` domain layer. The backend becomes pure orchestration (routes, auth, persistence, validation, wiring).

**Status: VERIFIED.** Backend tests **34/34** and new intelligence tests **11/11** pass (combined **45 passed**) after the move; the app imports cleanly from the backend working directory (simulating uvicorn).

```
Before:                          After:
Dory.md/                         Dory.md/
├── backend/                     ├── frontend/
│   ├── core/         ← logic    ├── backend/        ← orchestration only
│   ├── services/     ← logic    │   ├── routers/  services/(orchestration)
│   └── routers/                 │   ├── database/ models/ parsers/
└── frontend/                    │   └── observability.py  ratelimit.py
                                 └── intelligence/   ← NEW domain layer
```

---

## 1. What moved (and to where)

| From (backend) | To (intelligence) | Notes |
|---|---|---|
| `core/decay_engine.py` | `intelligence/memory/ebbinghaus.py` | + exported retention thresholds (single source of truth) |
| `services/scheduler_service.py` | `intelligence/memory/scheduler.py` | FSRS spaced-repetition (cognitive model) |
| `core/embeddings.py` | `intelligence/embeddings/provider.py` | SentenceTransformer singleton (lazy) |
| `services/chroma_service.py` | `intelligence/retrieval/vector_store.py` | ChromaDB adapter; gained `upsert_chunk` (P0-1) |
| `services/llm_service.py` | `intelligence/llm/provider.py` | provider abstraction |
| `services/category_service.py` (classification half) | `intelligence/llm/categorization.py` | now a **pure** `classify(content)->str` |
| quiz MCQ logic (`_FALLBACK_QUESTIONS`, `_MCQ_SYSTEM`, `_difficulty`, generation) from `routers/quiz.py` | `intelligence/llm/quiz_generation.py` | returns plain dicts |
| `core/chunker.py` | `intelligence/domain/chunking.py` | |
| `core/complexity.py` | `intelligence/domain/complexity.py` | |
| ranking math inlined in `routers/search.py` + `routers/_shared.py` | `intelligence/ranking/scoring.py` | `composite_score`, `recency_bonus`, `display_stability`, `display_complexity_k` |

`backend/core/` was deleted entirely. `backend/services/` now contains **only**
`category_service.py` — rewritten as a thin orchestration wrapper (classify via
intelligence, persist via `database.db`).

## 2. Why

- **Single responsibility / ownership.** Memory science, retrieval, ranking, and
  LLM logic were spread across `core/` and `services/`, interleaved with DB calls.
  They are now one cohesive, independently-testable package.
- **Testability.** The intelligence layer has pure unit tests that run in ~0.1s
  with no FastAPI, DB, network, or model load (`intelligence/tests/`).
- **Provider/model swapping & independent deployment.** Each subsystem hides its
  heavy/optional dependency (torch, chromadb, LLM SDKs) behind a lazy import and a
  `pyproject.toml` optional-extra, so the layer can be installed/deployed on its own.
- **Eliminated leakage.** Classification previously did `update_chunk_category`
  (DB write) from inside the "AI" module. That persistence concern moved back to
  the backend; intelligence now only computes.

## 3. Dependency boundary (and how it's enforced)

**Rule:** no module under `intelligence/` may import `database`, `routers`,
`models`, `services`, or `main`.

This is enforced by a test that AST-parses every non-test file under
`intelligence/` and fails on any forbidden import
(`intelligence/tests/test_intelligence.py::test_intelligence_does_not_import_backend`).
It passes today.

**Backend → intelligence is the only allowed direction**, and it goes through each
subpackage's public `__init__` interface, e.g.:

```python
from intelligence.memory import calculate_retention, classify_retention, grade
from intelligence.embeddings import embed_query, embed_texts, warm_model
from intelligence.retrieval import query_similar, add_chunks, upsert_chunk
from intelligence.ranking import composite_score, recency_bonus
from intelligence.llm import get_llm, classify, generate_mcq, FALLBACK_QUESTIONS
from intelligence.domain import chunk_text, complexity_score
```

## 4. How imports resolve

`intelligence/` is a sibling of `backend/`. The repo root is added to `sys.path`
in `backend/main.py` (runtime), `backend/tests/conftest.py` (tests), and
`backend/seed_demo_data.py`. For a standalone deployment, `pip install -e intelligence/`
(via the new `pyproject.toml`) makes `import intelligence` resolve without the shim.

## 5. Interface boundaries (orchestration vs domain)

| Concern | Intelligence (compute) | Backend (orchestrate/persist) |
|---|---|---|
| Categorization | `classify(content) -> category` | `services/category_service.classify_and_store` → `db.update_chunk_category` |
| Chunk edit re-index | `embed_query` + `vector_store.upsert_chunk` | `routers/chunks._reindex_chunk` calls them after the SQLite write |
| Review grading | `memory.grade(row, n) -> dict` | `routers/review` reads/writes the row via `db.apply_fsrs_update` |
| Quiz generation | `generate_mcq`, `FALLBACK_QUESTIONS`, `difficulty` | `routers/quiz` maps to API schema, owns the (in-memory) session store |
| Search ranking | `composite_score`, `recency_bonus` | `routers/search` fetches rows, computes days, shapes response |

## 6. Remaining coupling (honest)

- **`intelligence/retrieval/vector_store.py` default path** points at
  `backend/data/chroma` (to keep existing local data working). That's a config
  default, not a code import — overridable via `DORY_CHROMA_PATH`. It is the one
  place intelligence "knows" about the backend's data dir; documented and
  parameterized.
- **`memory.scheduler.grade(row)`** accepts a mapping with `fsrs_*` keys. It
  doesn't import the DB, but it does assume that column-naming convention — a
  shared vocabulary between layers. Acceptable; could be formalized with a typed
  DTO later.
- The backend still imports heavy intelligence subpackages at module load in a
  few routers (e.g. `intelligence.retrieval` pulls `chromadb`). That mirrors the
  pre-refactor behavior; no regression.

## 7. Risks

- **Path-shim fragility:** if someone runs the backend from an unexpected cwd
  without the repo root on `PYTHONPATH`, imports could fail. Mitigated by the
  explicit `sys.path` insert in `main.py` (resolves `__file__`-relative, cwd-independent)
  and by the optional editable install. VERIFIED to import from `backend/` cwd.
- **No behavioral change intended.** The moved code is byte-for-byte faithful
  except the documented additions (`upsert_chunk`, retention thresholds export,
  quiz-gen `int()` guard). The full test suite (including pre-existing tests)
  passing is the evidence.

## 8. Validation

```
$ python -m pytest backend/tests/ intelligence/tests/ -q
45 passed
$ python -c "import main"   # from backend/ cwd, DORY_SKIP_WARMUP=1
APP IMPORT OK: Dory.md API 1.0.0
```
