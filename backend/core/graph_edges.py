"""Semantic edge generation for the chunk knowledge graph.

Neighbors are discovered with the same per-user ChromaDB query the search
endpoint uses, so an edge can only ever be proposed between two chunks that
already belong to the same user. `db.upsert_edge` re-checks ownership in SQL
before writing, giving two independent guards on the isolation property.

Edges live only in SQLite. Chroma is *queried* here but never written, so this
introduces no new dual-write concern — there is no second store that can drift
out of sync with chunk_edges.

Config knobs (read per call so tests and deploys can override without a
restart), named as in BUILD.md section 1:

  SEMANTIC_EDGE_THRESHOLD   0.45  minimum cosine similarity for an edge
  MAX_EDGES_PER_CHUNK       8     cap on neighbors linked per chunk
  SPREAD_ALPHA              0.3   damping on propagated reinforcement (phase 2)
"""

import logging
import os

from database.db import count_edges, get_all_chunks, upsert_edge
from intelligence.retrieval import count as chroma_count, get_embeddings, query_similar

logger = logging.getLogger("dory.graph")

DEFAULT_EDGE_THRESHOLD = 0.45
DEFAULT_MAX_EDGES = 8
DEFAULT_SPREAD_ALPHA = 0.3


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def semantic_edge_threshold() -> float:
    """Minimum cosine similarity (tau) for an auto-generated edge."""
    return _env_float("SEMANTIC_EDGE_THRESHOLD", DEFAULT_EDGE_THRESHOLD, 0.0, 1.0)


def max_edges_per_chunk() -> int:
    """Cap (K) on how many neighbors one chunk may link to."""
    try:
        return max(0, int(os.getenv("MAX_EDGES_PER_CHUNK", str(DEFAULT_MAX_EDGES))))
    except (TypeError, ValueError):
        return DEFAULT_MAX_EDGES


def spread_alpha() -> float:
    """Global damping (alpha) applied to propagated reinforcement."""
    return _env_float("SPREAD_ALPHA", DEFAULT_SPREAD_ALPHA, 0.0, 1.0)


def generate_edges_for_chunk(
    user_id: str,
    chunk_id: str,
    embedding: list[float] | None = None,
) -> int:
    """Link one chunk to its nearest same-user neighbors above the threshold.

    Pass `embedding` when the caller already has it (the ingest path does) to
    skip a Chroma round-trip; otherwise it is fetched by id. Returns the number
    of edges written, counting weight updates to existing edges.
    """
    k = max_edges_per_chunk()
    if k <= 0 or chroma_count() == 0:
        return 0

    if embedding is None:
        embedding = get_embeddings([chunk_id], user_id).get(chunk_id)
        if embedding is None:
            # No stored vector for this chunk (or it is not this user's).
            return 0

    # Ask for one extra: the chunk itself is its own nearest neighbor.
    results = query_similar(embedding, user_id, n_results=k + 1)
    threshold = semantic_edge_threshold()

    written = 0
    for neighbor_id, similarity in zip(results["ids"], results["similarities"]):
        if written >= k:
            break
        if neighbor_id == chunk_id or similarity < threshold:
            continue
        if upsert_edge(user_id, chunk_id, neighbor_id, weight=float(similarity)):
            written += 1
    return written


def rebuild_edges_for_user(user_id: str) -> dict:
    """Regenerate edges across all of a user's chunks.

    Idempotent: the unique constraint plus the upsert means a second run
    rewrites the same rows rather than adding any, so `edges_created` — the net
    change in row count — is 0 the second time through.
    """
    chunks = get_all_chunks(user_id)
    before = count_edges(user_id)

    chunk_ids = [row["id"] for row in chunks]
    embeddings = get_embeddings(chunk_ids, user_id)

    for chunk_id in chunk_ids:
        generate_edges_for_chunk(user_id, chunk_id, embedding=embeddings.get(chunk_id))

    total = count_edges(user_id)
    return {"edges_created": total - before, "edges_total": total}


def generate_edges_safely(user_id: str, chunk_id: str, embedding: list[float] | None = None) -> None:
    """Fire-and-forget wrapper for the ingest path.

    Edge generation is an enrichment, not part of the ingest contract: a Chroma
    hiccup here must not fail an ingest whose dual write already succeeded, so
    failures are logged and swallowed.
    """
    try:
        generate_edges_for_chunk(user_id, chunk_id, embedding=embedding)
    except Exception:
        logger.exception("Edge generation failed for chunk %s", chunk_id)
