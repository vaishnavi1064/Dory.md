"""Memory science: forgetting-curve retention + spaced-repetition scheduling."""

from intelligence.memory.ebbinghaus import (
    FADING_THRESHOLD,
    STRONG_THRESHOLD,
    WEAK_THRESHOLD,
    calculate_retention,
    calculate_retention_batch,
    classify_retention,
    complexity_modifier,
    hours_until_retention,
    stability,
)
from intelligence.memory.scheduler import VALID_GRADES, grade
from intelligence.memory.spreading import (
    Neighbor,
    RetentionNeighbor,
    propagate_reinforcement,
    propagate_retention_refresh,
)

__all__ = [
    "calculate_retention",
    "calculate_retention_batch",
    "classify_retention",
    "stability",
    "complexity_modifier",
    "hours_until_retention",
    "STRONG_THRESHOLD",
    "FADING_THRESHOLD",
    "WEAK_THRESHOLD",
    "grade",
    "VALID_GRADES",
    "Neighbor",
    "propagate_reinforcement",
    "RetentionNeighbor",
    "propagate_retention_refresh",
]
