from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from core.decay_engine import calculate_retention, classify_retention
from database.db import get_all_chunks
from models.schemas import ChunkOut, FadingResponse
from routers.deps import get_current_user_id

router = APIRouter()


def _parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _time_ago(dt: datetime) -> str:
    now = datetime.now(tz=timezone.utc)
    delta = now - dt
    days = delta.days
    if days == 0:
        hours = delta.seconds // 3600
        return f"{hours}h ago" if hours else "just now"
    if days < 30:
        return f"{days}d ago"
    months = days // 30
    return f"{months}mo ago"


@router.get("/fading", response_model=FadingResponse)
def get_fading(
    limit: int = Query(default=20, ge=1, le=2000),
    user_id: str = Depends(get_current_user_id),
):
    rows = get_all_chunks(user_id)
    results: list[ChunkOut] = []

    for row in rows:
        last_accessed = _parse_dt(row["last_accessed"])
        r = calculate_retention(last_accessed, row["access_count"], row["complexity_score"])
        if r < 0.8:
            results.append(
                ChunkOut(
                    chunk_id=row["id"],
                    content=row["content"][:300],
                    source_file=row["source_file"],
                    category=row["category"],
                    retention=round(r, 4),
                    status=classify_retention(r),
                    last_accessed=_time_ago(last_accessed),
                    last_accessed_iso=last_accessed.isoformat(),
                    access_count=row["access_count"],
                )
            )

    results.sort(key=lambda x: x.retention)
    return FadingResponse(chunks=results[:limit], total_fading=len(results))
