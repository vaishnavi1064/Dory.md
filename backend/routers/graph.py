"""Knowledge-graph read API.

  GET  /api/graph                              — nodes + edges for the graph view
  GET  /api/graph/chunk/{chunk_id}/neighbors   — one chunk's immediate neighbours
  POST /api/graph/rebuild                      — backfill edges for existing chunks

Every query is scoped to the authenticated user, and edges are filtered down to
the nodes actually returned so the client never receives a dangling endpoint.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from core.graph_edges import rebuild_edges_for_user
from database.db import (
    get_all_chunks,
    get_chunk,
    get_chunk_neighbors,
    get_edges_for_user,
)
from intelligence.memory import calculate_retention, classify_retention
from models.schemas import (
    GraphEdge,
    GraphNeighbor,
    GraphNode,
    GraphRebuildResponse,
    GraphResponse,
)
from routers._shared import parse_dt
from routers.deps import get_current_user_id

router = APIRouter()

BUCKETS = {"strong", "fading", "weak", "critical"}
LABEL_CHARS = 80


def _label(content: str) -> str:
    """A short single-line preview for a node caption."""
    flat = " ".join((content or "").split())
    return flat[:LABEL_CHARS]


def _retention_of(row) -> float:
    return calculate_retention(
        parse_dt(row["last_accessed"]), row["access_count"], row["complexity_score"]
    )


@router.get("/graph", response_model=GraphResponse)
def get_graph(
    bucket: str | None = Query(default=None),
    focus_chunk_id: str | None = Query(default=None),
    limit: int = Query(default=300, ge=1, le=2000),
    user_id: str = Depends(get_current_user_id),
):
    """Nodes and edges for the graph view.

    `bucket` keeps only chunks in that retention band. `focus_chunk_id` narrows
    the response to that chunk and its immediate neighbours. `limit` bounds the
    node count; the weakest-retention chunks are kept first, since those are the
    ones worth looking at.
    """
    if bucket is not None and bucket not in BUCKETS:
        raise HTTPException(
            status_code=400, detail=f"bucket must be one of {sorted(BUCKETS)}"
        )

    rows = {row["id"]: row for row in get_all_chunks(user_id)}

    if focus_chunk_id is not None:
        if focus_chunk_id not in rows:
            raise HTTPException(status_code=404, detail="Chunk not found.")
        neighborhood = {focus_chunk_id} | {
            r["neighbor_id"] for r in get_chunk_neighbors(focus_chunk_id, user_id)
        }
        rows = {cid: row for cid, row in rows.items() if cid in neighborhood}

    retentions = {cid: _retention_of(row) for cid, row in rows.items()}
    if bucket is not None:
        rows = {
            cid: row
            for cid, row in rows.items()
            if classify_retention(retentions[cid]) == bucket
        }

    # Weakest first, so a truncated graph still shows what is being forgotten.
    ordered = sorted(rows, key=lambda cid: retentions[cid])[:limit]
    kept = set(ordered)

    edges = [
        GraphEdge(
            source=e["source_id"],
            target=e["target_id"],
            weight=round(e["weight"], 4),
            type=e["edge_type"],
        )
        for e in get_edges_for_user(user_id)
        if e["source_id"] in kept and e["target_id"] in kept
    ]

    degree: dict[str, int] = {cid: 0 for cid in kept}
    for edge in edges:
        degree[edge.source] += 1
        degree[edge.target] += 1

    nodes = [
        GraphNode(
            id=cid,
            label=_label(rows[cid]["content"]),
            retention=round(retentions[cid], 4),
            bucket=classify_retention(retentions[cid]),
            degree=degree[cid],
        )
        for cid in ordered
    ]
    return GraphResponse(nodes=nodes, edges=edges)


@router.get("/graph/chunk/{chunk_id}/neighbors", response_model=list[GraphNeighbor])
def get_neighbors(chunk_id: str, user_id: str = Depends(get_current_user_id)):
    """One chunk's immediate neighbours, strongest edge first."""
    if get_chunk(chunk_id, user_id) is None:
        raise HTTPException(status_code=404, detail="Chunk not found.")

    out: list[GraphNeighbor] = []
    for row in get_chunk_neighbors(chunk_id, user_id):
        r = _retention_of(row)
        out.append(
            GraphNeighbor(
                chunk_id=row["neighbor_id"],
                label=_label(row["content"]),
                weight=round(row["weight"], 4),
                type=row["edge_type"],
                retention=round(r, 4),
                bucket=classify_retention(r),
            )
        )
    return out


@router.post("/graph/rebuild", response_model=GraphRebuildResponse)
def rebuild_graph(user_id: str = Depends(get_current_user_id)):
    """Regenerate edges across all of the user's chunks.

    Used to backfill chunks ingested before the graph existed. Idempotent: a
    second run rewrites the same rows and reports edges_created = 0.
    """
    result = rebuild_edges_for_user(user_id)
    return GraphRebuildResponse(**result)
