"""Locked mood vocabulary — single source of truth for Phase 1 data collection."""

from enum import Enum
from typing import Literal

Mood = Literal[
    "focused",
    "neutral",
    "anxious",
    "tired",
    "energized",
    "calm",
    "frustrated",
]

EventType = Literal["create", "review", "quiz"]

VALID_MOODS: frozenset[str] = frozenset({
    "focused",
    "neutral",
    "anxious",
    "tired",
    "energized",
    "calm",
    "frustrated",
})

VALID_EVENT_TYPES: frozenset[str] = frozenset({"create", "review", "quiz"})


class MoodLabel(str, Enum):
    """Enum-style mirror of VALID_MOODS for ordered iteration."""

    FOCUSED = "focused"
    NEUTRAL = "neutral"
    ANXIOUS = "anxious"
    TIRED = "tired"
    ENERGIZED = "energized"
    CALM = "calm"
    FRUSTRATED = "frustrated"


MOOD_ORDER: tuple[str, ...] = tuple(m.value for m in MoodLabel)
