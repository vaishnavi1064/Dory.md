from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.decay_engine import calculate_retention
from database.db import update_chunk_access
from models.schemas import ReviewResponse
from routers.deps import get_current_user_id

router = APIRouter()


@router.post("/review/{chunk_id}", response_model=ReviewResponse)
def review_chunk(chunk_id: str, user_id: str = Depends(get_current_user_id)):
    updated = update_chunk_access(chunk_id, user_id=user_id, source="review")
    if updated is None:
        raise HTTPException(status_code=404, detail="Chunk not found.")

    last_accessed = datetime.fromisoformat(updated["last_accessed"]).replace(tzinfo=timezone.utc)
    new_r = calculate_retention(last_accessed, updated["access_count"], updated["complexity_score"])

    return ReviewResponse(
        chunk_id=chunk_id,
        new_retention=round(new_r, 4),
        access_count=updated["access_count"],
        message=f"Memory revived. Retention now {new_r:.0%}.",
    )
