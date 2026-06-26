"""Mood tagging Phase 1 — log, history, and stats (data collection only)."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from core.mood import MOOD_ORDER, VALID_EVENT_TYPES, VALID_MOODS
from database.db import get_chunk, get_mood_logs, insert_chunk_state_log
from models.schemas import MoodHistoryResponse, MoodLogRequest, MoodLogResponse, MoodStatsResponse
from ratelimit import rate_limit
from routers.deps import get_current_user_id

router = APIRouter()

_INSIGHT_MIN_LOGS = 5


def _empty_mood_counts() -> dict[str, int]:
    return {m: 0 for m in MOOD_ORDER}


def _empty_event_counts() -> dict[str, int]:
    return {"create": 0, "review": 0, "quiz": 0}


def _build_insights(
    total: int,
    mood_counts: dict[str, int],
    event_counts: dict[str, int],
    mood_by_event: dict[str, dict[str, int]],
) -> list[str]:
    if total < _INSIGHT_MIN_LOGS:
        return ["Not enough data yet — keep logging your mood to see patterns."]

    insights: list[str] = []

    if total >= 30:
        top_mood = max(MOOD_ORDER, key=lambda m: mood_counts[m])
        pct = round(mood_counts[top_mood] / total * 100)
        insights.append(f"Your dominant state overall: {top_mood} ({pct}%)")

    event_labels = {
        "create": "creating notes",
        "review": "reviewing chunks",
        "quiz": "taking quizzes",
    }
    for event_type, label in event_labels.items():
        counts = mood_by_event[event_type]
        event_total = event_counts[event_type]
        if event_total == 0:
            continue
        top = max(MOOD_ORDER, key=lambda m: counts[m])
        if counts[top] == 0:
            continue
        pct = round(counts[top] / event_total * 100)
        insights.append(f"Your most common state when {label}: {top} ({pct}%)")

    return insights


@router.post(
    "/mood/log",
    response_model=MoodLogResponse,
    status_code=201,
    dependencies=[Depends(rate_limit("mood", limit=60))],
)
def log_mood(body: MoodLogRequest, user_id: str = Depends(get_current_user_id)):
    if body.mood not in VALID_MOODS:
        raise HTTPException(status_code=400, detail="Invalid mood.")
    if body.event_type not in VALID_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid event_type.")

    if body.chunk_id is not None and get_chunk(body.chunk_id, user_id) is None:
        raise HTTPException(status_code=404, detail="Chunk not found.")

    row_id = insert_chunk_state_log(body.chunk_id, user_id, body.mood, body.event_type)
    return MoodLogResponse(id=row_id)


@router.get("/mood/history", response_model=MoodHistoryResponse)
def mood_history(
    user_id: str = Depends(get_current_user_id),
    days: int = Query(30, ge=1, le=365),
):
    rows = get_mood_logs(user_id, days=days)
    entries = [
        {
            "id": r["id"],
            "chunk_id": r["chunk_id"],
            "mood": r["mood"],
            "event_type": r["event_type"],
            "logged_at": r["logged_at"],
        }
        for r in rows
    ]
    return MoodHistoryResponse(entries=entries)


@router.get("/mood/stats", response_model=MoodStatsResponse)
def mood_stats(
    user_id: str = Depends(get_current_user_id),
    days: int = Query(30, ge=1, le=365),
):
    rows = get_mood_logs(user_id, days=days)
    total = len(rows)

    mood_counts = _empty_mood_counts()
    event_counts = _empty_event_counts()
    mood_by_event: dict[str, dict[str, int]] = {
        et: _empty_mood_counts() for et in VALID_EVENT_TYPES
    }

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=days - 1)
    date_keys = [
        (start_date + timedelta(days=i)).isoformat()
        for i in range(days)
    ]
    mood_over_time_map: dict[str, dict[str, int]] = {
        d: _empty_mood_counts() for d in date_keys
    }

    for row in rows:
        mood = row["mood"]
        event_type = row["event_type"]
        if mood in mood_counts:
            mood_counts[mood] += 1
        if event_type in event_counts:
            event_counts[event_type] += 1
        if event_type in mood_by_event and mood in mood_by_event[event_type]:
            mood_by_event[event_type][mood] += 1

        logged_at = row["logged_at"]
        try:
            day_key = logged_at[:10]
        except (TypeError, IndexError):
            continue
        if day_key in mood_over_time_map and mood in mood_over_time_map[day_key]:
            mood_over_time_map[day_key][mood] += 1

    mood_over_time = [
        {"date": d, **mood_over_time_map[d]}
        for d in date_keys
    ]

    insights = _build_insights(total, mood_counts, event_counts, mood_by_event)

    return MoodStatsResponse(
        total_logs=total,
        mood_counts=mood_counts,
        event_counts=event_counts,
        mood_by_event=mood_by_event,
        mood_over_time=mood_over_time,
        insights=insights,
    )
