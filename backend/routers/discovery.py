"""
GET /api/discovery

Returns the single most at-risk relevant chunk as a slide-in discovery card.
Picks the non-critical chunk with the lowest retention (highest decay urgency).
Returns {has_discovery: false} when nothing warrants a notification.
"""
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from core.decay_engine import calculate_retention, classify_retention, stability, complexity_modifier, _BASE_HOURS
from database.db import get_all_chunks
from routers.deps import get_current_user_id

router = APIRouter()

_REASONS = [
    "This memory is slipping away — time to review.",
    "You haven't visited this in a while.",
    "This chunk is fading fast from your knowledge graph.",
    "Ebbinghaus says you're about to forget this.",
    "Rediscover this before it's gone.",
]


def _parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _to_chunk_full(row: dict, retention: float) -> dict:
    access_count = row["access_count"]
    complexity_score = row["complexity_score"]
    S = round((1.0 + 0.5 * math.log1p(access_count)) * 9.0, 2)
    k = round(0.5 + 1.5 * max(0.0, min(1.0, complexity_score)), 3)

    source_file = row["source_file"] or ""
    if source_file.startswith("Notion:"):
        source_type, source_name = "url", source_file[7:].strip()
    elif "." in source_file and source_file.rsplit(".", 1)[-1].lower() in (
        "pdf", "docx", "txt", "md", "html", "htm", "rst", "json"
    ):
        source_type = "file"
        source_name = source_file.replace("\\", "/").split("/")[-1]
    else:
        source_type = "note"
        source_name = source_file or "manual entry"

    return {
        "id": row["id"],
        "content": row["content"][:400],
        "source_type": source_type,
        "source_name": source_name,
        "category": row["category"] or "general",
        "created_at": row["created_at"],
        "last_accessed": row["last_accessed"],
        "access_count": access_count,
        "stability_S": S,
        "complexity_k": k,
        "retention": round(retention, 4),
        "tags": [],
    }


@router.get("/discovery")
def get_discovery(user_id: str = Depends(get_current_user_id)):
    rows = get_all_chunks(user_id)
    if not rows:
        return {"has_discovery": False}

    best_row = None
    best_retention = 1.0

    for row in rows:
        row = dict(row)
        last_accessed = _parse_dt(row["last_accessed"])
        r = calculate_retention(last_accessed, row["access_count"], row["complexity_score"])
        if 0.1 <= r <= 0.65 and r < best_retention:
            best_retention = r
            best_row = row

    if best_row is None:
        return {"has_discovery": False}

    import random
    reason = _REASONS[hash(best_row["id"]) % len(_REASONS)]

    return {
        "has_discovery": True,
        "chunk": _to_chunk_full(best_row, best_retention),
        "reason": reason,
    }
