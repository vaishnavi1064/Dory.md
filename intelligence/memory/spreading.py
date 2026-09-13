"""
Spreading activation across the chunk knowledge graph.

When a chunk is reviewed, FSRS raises its stability by some gain ΔS. A damped
fraction of that gain flows to its semantically linked neighbors:

    new_stability = current_stability + ΔS * edge_weight * alpha

  ΔS          = the reviewed chunk's stability gain (FSRS S_after - S_before)
  edge_weight = cosine similarity carried on the edge, 0.0 – 1.0
  alpha       = global damping, 0.0 – 1.0 (SPREAD_ALPHA, default 0.3)

Because reinforcement flows through *stability*, it feeds the existing
decay_urgency term in ranking/scoring.py automatically — the 0.4/0.4/0.2
composite needs no change.

Only gains propagate. FSRS returns a negative ΔS for a failed review
(grade 1 = Again), but a neighbor that was not the one forgotten should not be
punished for it, so a negative gain is clamped to zero and no neighbor is ever
returned below its current stability.

Neighbors whose reinforcement works out to zero are omitted from the result
rather than returned unchanged, so the caller never issues a no-op write.

Single-hop only: the reviewed chunk's direct neighbors, not their neighbors.
Pure — imports nothing from `backend`. The caller is responsible for coalescing
a NULL `fsrs_stability` to a float before building a Neighbor.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Neighbor:
    """One edge-adjacent chunk, as seen from the chunk being reviewed."""

    chunk_id: str  # chunks.id is a TEXT uuid, not an integer
    edge_weight: float  # 0.0 – 1.0
    current_stability: float


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def propagate_reinforcement(
    reviewed_stability_gain: float,
    neighbors: list[Neighbor],
    alpha: float = 0.3,
    max_stability: float | None = None,
) -> dict[str, float]:
    """Single-hop spreading activation.

    Returns {chunk_id: new_stability} for the neighbors that should be
    reinforced. Neighbors receiving no reinforcement are omitted, so an empty
    neighbor list, a zero gain, or a negative gain all return {}.

    Never raises on empty input.
    """
    gain = max(0.0, reviewed_stability_gain)
    if gain == 0.0 or not neighbors:
        return {}

    a = _clamp01(alpha)
    if a == 0.0:
        return {}

    reinforced: dict[str, float] = {}
    for n in neighbors:
        delta = gain * _clamp01(n.edge_weight) * a
        if delta <= 0.0:
            continue

        new_stability = n.current_stability + delta
        if max_stability is not None:
            new_stability = min(new_stability, max_stability)
        # A neighbor already at or above the ceiling keeps its current value
        # rather than being dragged down by the clamp.
        new_stability = max(new_stability, n.current_stability)

        if new_stability > n.current_stability:
            reinforced[n.chunk_id] = new_stability

    return reinforced
