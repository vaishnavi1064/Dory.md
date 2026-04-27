from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from core.decay_engine import calculate_retention
from database.db import delete_chunk, get_all_chunks
from models.schemas import StatsResponse
from routers.deps import get_current_user_id
from services.chroma_service import delete_chunk as chroma_delete

router = APIRouter()


def _parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


@router.get("/stats", response_model=StatsResponse)
def get_stats(user_id: str = Depends(get_current_user_id)):
    rows = get_all_chunks(user_id)
    if not rows:
        return StatsResponse(total_chunks=0, avg_retention=1.0, strong=0, fading=0, weak=0, critical=0)

    retentions = [
        calculate_retention(_parse_dt(r["last_accessed"]), r["access_count"], r["complexity_score"])
        for r in rows
    ]
    counts = {"strong": 0, "fading": 0, "weak": 0, "critical": 0}
    for r in retentions:
        if r >= 0.8:
            counts["strong"] += 1
        elif r >= 0.5:
            counts["fading"] += 1
        elif r >= 0.2:
            counts["weak"] += 1
        else:
            counts["critical"] += 1

    return StatsResponse(
        total_chunks=len(rows),
        avg_retention=round(float(np.mean(retentions)), 4),
        **counts,
    )


@router.delete("/chunks/{chunk_id}")
def remove_chunk(chunk_id: str, user_id: str = Depends(get_current_user_id)):
    try:
        chroma_delete(chunk_id)
    except Exception:
        pass
    delete_chunk(chunk_id)
    return {"message": "Chunk deleted.", "chunk_id": chunk_id}
