"""Review endpoints.

  POST /api/review/{chunk_id}   — legacy "mark as viewed" bump (still used by
                                  the note-detail panel for non-quiz access)
  GET  /api/review/queue        — cards currently due for FSRS review
  POST /api/review/grade        — submit a self-grade (1-4) for one card,
                                  advances FSRS state, returns next due date
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from intelligence.memory import calculate_retention
from intelligence.memory import (
    Neighbor,
    RetentionNeighbor,
    VALID_GRADES,
    grade as fsrs_grade,
    propagate_reinforcement,
    propagate_retention_refresh,
)
from core.graph_edges import spread_alpha
from database.db import (
    apply_fsrs_update_with_propagation,
    count_due_chunks,
    get_chunk,
    get_chunk_neighbors,
    get_review_queue,
    update_chunk_access,
)
from models.schemas import (
    GradeRequest,
    GradeResponse,
    ReviewCard,
    ReviewQueueResponse,
    ReviewResponse,
)
from routers._shared import retention_anchor
from routers.deps import get_current_user_id

router = APIRouter()

# 1=Again is a failed recall; 2=Hard, 3=Good and 4=Easy all mean it was
# recalled. Only a successful recall spreads a retention refresh.
PASSING_GRADES = {2, 3, 4}


@router.get("/review/queue", response_model=ReviewQueueResponse)
def review_queue(
    limit: int = Query(default=20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    """Return chunks due for review, oldest-due first."""
    rows = get_review_queue(user_id, limit=limit)
    total = count_due_chunks(user_id)
    cards = [
        ReviewCard(
            chunk_id=r["id"],
            content=r["content"],
            source_file=r["source_file"],
            category=r["category"],
            fsrs_state=r["fsrs_state"] or 1,
            fsrs_due=r["fsrs_due"],
            fsrs_stability=r["fsrs_stability"],
            fsrs_difficulty=r["fsrs_difficulty"],
            fsrs_last_review=r["fsrs_last_review"],
        )
        for r in rows
    ]
    return ReviewQueueResponse(cards=cards, due_count=total)


@router.post("/review/grade", response_model=GradeResponse)
def review_grade(body: GradeRequest, user_id: str = Depends(get_current_user_id)):
    """Apply a self-grade (1=Again, 2=Hard, 3=Good, 4=Easy) to a chunk and
    advance the FSRS schedule. Returns the new due date."""
    if body.grade not in VALID_GRADES:
        raise HTTPException(status_code=400, detail="Grade must be 1, 2, 3, or 4.")

    row = get_chunk(body.chunk_id, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Chunk not found.")

    stability_before = row["fsrs_stability"]
    fsrs = fsrs_grade(row, body.grade)

    # Spreading activation has two halves, both damped by edge_weight * alpha and
    # both fed by one neighbour read: stability (drives future FSRS scheduling)
    # and retention (what search, the buckets, the fading feed and Time Machine
    # actually read). They fire on different triggers - see each helper.
    neighbor_rows = get_chunk_neighbors(body.chunk_id, user_id)

    reinforced = _reinforce_neighbors(
        neighbor_rows,
        stability_before=stability_before,
        stability_after=fsrs["fsrs_stability"],
    )
    refreshed = _refresh_neighbor_retention(neighbor_rows, grade=body.grade)

    # One transaction: the review and every affected neighbour land together.
    if not apply_fsrs_update_with_propagation(
        body.chunk_id, user_id, fsrs, reinforced, refreshed
    ):
        # Should never happen since we just read it above with the same user_id.
        raise HTTPException(status_code=404, detail="Chunk not found.")

    return GradeResponse(
        chunk_id=body.chunk_id,
        grade=body.grade,
        next_due=fsrs["fsrs_due"],
        stability=fsrs["fsrs_stability"],
        difficulty=fsrs["fsrs_difficulty"],
        state=fsrs["fsrs_state"],
        reinforced_neighbor_count=len(set(reinforced) | set(refreshed)),
    )


def _reinforce_neighbors(neighbor_rows, stability_before, stability_after) -> dict:
    """Work out each neighbour's new FSRS stability after a review.

    Driven by the stability gain, so it only fires from a chunk's second grade
    onwards — the first has no prior stability to measure a gain against.
    Returns {chunk_id: new_stability}; does not write.
    """
    if stability_before is None or stability_after is None:
        return {}

    gain = stability_after - stability_before
    if gain <= 0:
        # A failed review (grade 1) lowers stability; that loss is the reviewer's
        # alone and is not propagated to neighbours.
        return {}

    neighbors = [
        Neighbor(
            chunk_id=r["neighbor_id"],
            edge_weight=r["weight"],
            # A neighbour that has never been graded has no stability yet.
            current_stability=r["fsrs_stability"] or 0.0,
        )
        for r in neighbor_rows
    ]
    if not neighbors:
        return {}

    return propagate_reinforcement(
        gain, neighbors, alpha=spread_alpha(), max_stability=None
    )


def _refresh_neighbor_retention(neighbor_rows, grade: int) -> dict:
    """Partially refresh neighbours' retention after a successful recall.

    Deliberately triggered by recall success rather than by a stability gain, so
    a chunk's very first passing grade already moves its neighbours. This is the
    half of spreading activation that search ranking, the dashboard buckets, the
    fading feed and Time Machine can actually see, since all of them read
    Ebbinghaus retention rather than FSRS stability.

    Returns {chunk_id: new_anchor_iso}; does not write.
    """
    if grade not in PASSING_GRADES or not neighbor_rows:
        return {}

    now = datetime.now(tz=timezone.utc)
    neighbors = [
        RetentionNeighbor(
            chunk_id=r["neighbor_id"],
            edge_weight=r["weight"],
            current_anchor=retention_anchor(r),
        )
        for r in neighbor_rows
    ]
    moved = propagate_retention_refresh(neighbors, now, alpha=spread_alpha())
    return {cid: anchor.isoformat() for cid, anchor in moved.items()}


@router.post("/review/{chunk_id}", response_model=ReviewResponse)
def review_chunk(chunk_id: str, user_id: str = Depends(get_current_user_id)):
    """Legacy 'I viewed this chunk' bump. Increments access_count and recomputes
    Ebbinghaus retention for the dashboard. Does NOT advance the FSRS scheduler —
    use POST /review/grade for that."""
    updated = update_chunk_access(chunk_id, user_id=user_id, source="review")
    if updated is None:
        raise HTTPException(status_code=404, detail="Chunk not found.")

    last_accessed = datetime.fromisoformat(updated["last_accessed"]).replace(tzinfo=timezone.utc)
    new_r = calculate_retention(retention_anchor(updated), updated["access_count"], updated["complexity_score"])

    return ReviewResponse(
        chunk_id=chunk_id,
        new_retention=round(new_r, 4),
        access_count=updated["access_count"],
        message=f"Memory revived. Retention now {new_r:.0%}.",
    )
