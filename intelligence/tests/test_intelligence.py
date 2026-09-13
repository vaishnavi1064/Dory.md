"""Unit tests for the intelligence layer.

Pure logic only — no FastAPI, no DB, no network, and no heavy ML model load
(embeddings/LLM/Chroma are exercised via the backend integration tests). These
also enforce the architectural boundary: nothing under intelligence/ may import
the backend.
"""

import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path

from intelligence.domain import chunk_text, complexity_score
from intelligence.memory import (
    Neighbor,
    calculate_retention,
    calculate_retention_batch,
    classify_retention,
    propagate_reinforcement,
)
from intelligence.ranking import (
    composite_score,
    display_complexity_k,
    display_stability,
    recency_bonus,
)


# ── Ebbinghaus retention ──────────────────────────────────────────────────────

def test_fresh_chunk_has_high_retention():
    now = datetime.now(timezone.utc)
    r = calculate_retention(now, access_count=0, complexity_score=0.5)
    assert r > 0.99


def test_retention_decreases_over_time():
    now = datetime.now(timezone.utc)
    recent = calculate_retention(now - timedelta(days=2), 1, 0.5)
    old = calculate_retention(now - timedelta(days=60), 1, 0.5)
    assert recent > old
    assert 0.0 <= old <= recent <= 1.0


def test_more_reviews_slow_decay():
    old = datetime.now(timezone.utc) - timedelta(days=20)
    few = calculate_retention(old, access_count=1, complexity_score=0.5)
    many = calculate_retention(old, access_count=10, complexity_score=0.5)
    assert many > few


def test_classify_retention_buckets():
    assert classify_retention(0.95) == "strong"
    assert classify_retention(0.6) == "fading"
    assert classify_retention(0.3) == "weak"
    assert classify_retention(0.05) == "critical"


def test_batch_matches_scalar():
    now = datetime.now(timezone.utc)
    dts = [now - timedelta(days=d) for d in (1, 10, 30)]
    counts = [0, 2, 1]
    scores = [0.5, 0.7, 0.3]
    batch = calculate_retention_batch(dts, counts, scores)
    for i, dt in enumerate(dts):
        assert abs(batch[i] - calculate_retention(dt, counts[i], scores[i])) < 1e-9


# ── Ranking ───────────────────────────────────────────────────────────────────

def test_composite_score_weights():
    # similarity 1, retention 1 (no urgency), recency 0 -> 0.4
    assert abs(composite_score(1.0, 1.0, 0.0) - 0.4) < 1e-9
    # urgency dominates when retention is 0
    assert composite_score(0.0, 0.0, 0.0) == 0.4


def test_recency_bonus_monotonic():
    assert recency_bonus(0) > recency_bonus(30) > recency_bonus(365)
    assert abs(recency_bonus(0) - 1.0) < 1e-9


def test_display_metrics_ranges():
    assert display_stability(0) == 9.0
    assert display_stability(10) > display_stability(0)
    assert 0.5 <= display_complexity_k(0.0) <= display_complexity_k(1.0) <= 2.0


# ── Chunking & complexity ─────────────────────────────────────────────────────

def test_chunk_text_returns_nonempty_for_real_text():
    text = "\n\n".join(["This is a paragraph about memory science."] * 5)
    chunks = chunk_text(text)
    assert chunks and all(isinstance(c, str) and c.strip() for c in chunks)


def test_complexity_score_in_range():
    assert 0.0 <= complexity_score("hello world") <= 1.0
    assert complexity_score("") == 0.5  # empty guard
    # code-bearing text scores higher than plain prose of similar length
    code = "def f(x):\n    return x + 1\n"
    prose = "the the the the the the the the"
    assert complexity_score(code) > complexity_score(prose)


# ── Spreading activation ──────────────────────────────────────────────────────

def _n(chunk_id="c1", weight=1.0, stability_=10.0):
    return Neighbor(chunk_id=chunk_id, edge_weight=weight, current_stability=stability_)


def test_no_neighbors_returns_empty():
    assert propagate_reinforcement(5.0, []) == {}


def test_single_neighbor_scales_by_weight_and_alpha():
    out = propagate_reinforcement(10.0, [_n(weight=0.5, stability_=2.0)], alpha=0.3)
    # 2.0 + 10.0 * 0.5 * 0.3 = 3.5
    assert out == {"c1": 3.5}


def test_multiple_neighbors_each_scale_independently():
    out = propagate_reinforcement(
        4.0,
        [_n("a", 1.0, 1.0), _n("b", 0.5, 1.0), _n("c", 0.25, 8.0)],
        alpha=0.5,
    )
    assert out["a"] == 1.0 + 4.0 * 1.0 * 0.5
    assert out["b"] == 1.0 + 4.0 * 0.5 * 0.5
    assert out["c"] == 8.0 + 4.0 * 0.25 * 0.5
    assert set(out) == {"a", "b", "c"}


def test_clamped_at_max_stability():
    out = propagate_reinforcement(100.0, [_n(weight=1.0, stability_=9.0)], alpha=1.0, max_stability=10.0)
    assert out == {"c1": 10.0}


def test_never_returns_below_current_stability():
    # A neighbor already above the ceiling is left alone, not dragged down.
    out = propagate_reinforcement(5.0, [_n(weight=1.0, stability_=50.0)], alpha=1.0, max_stability=10.0)
    assert out == {}

    many = [_n("a", 1.0, 1.0), _n("b", 0.0, 7.0), _n("c", 0.3, 2.0)]
    for chunk_id, new_stability in propagate_reinforcement(3.0, many).items():
        current = next(n.current_stability for n in many if n.chunk_id == chunk_id)
        assert new_stability >= current


def test_negative_gain_does_not_punish_neighbors():
    # FSRS returns a negative delta-S for grade 1 (Again); it must not propagate.
    assert propagate_reinforcement(-4.0, [_n(weight=1.0, stability_=3.0)], alpha=1.0) == {}


def test_zero_gain_and_zero_weight_are_no_ops():
    assert propagate_reinforcement(0.0, [_n()]) == {}
    assert propagate_reinforcement(5.0, [_n(weight=0.0)]) == {}
    assert propagate_reinforcement(5.0, [_n()], alpha=0.0) == {}


def test_out_of_range_weight_and_alpha_are_clamped():
    over = propagate_reinforcement(10.0, [_n(weight=5.0, stability_=0.0)], alpha=9.0)
    assert over == {"c1": 10.0}  # weight and alpha both clamp to 1.0
    under = propagate_reinforcement(10.0, [_n(weight=-2.0, stability_=1.0)], alpha=-1.0)
    assert under == {}


def test_deterministic_for_identical_inputs():
    args = (7.5, [_n("a", 0.8, 1.5), _n("b", 0.62, 4.0)], 0.3, 20.0)
    assert propagate_reinforcement(*args) == propagate_reinforcement(*args)


def test_single_hop_only_ignores_neighbor_of_neighbor():
    # The function sees a flat list; it must reinforce exactly those ids and no others.
    out = propagate_reinforcement(6.0, [_n("direct", 1.0, 1.0)], alpha=0.3)
    assert list(out) == ["direct"]


# ── Architectural boundary ────────────────────────────────────────────────────

def test_intelligence_does_not_import_backend():
    """No module under intelligence/ may import backend packages."""
    forbidden = {"database", "routers", "models", "services", "main"}
    root = Path(__file__).resolve().parent.parent
    offenders = []
    for py in root.rglob("*.py"):
        if "tests" in py.parts:
            continue
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".")[0] in forbidden:
                        offenders.append((str(py), alias.name))
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.module.split(".")[0] in forbidden:
                    offenders.append((str(py), node.module))
    assert not offenders, f"intelligence layer leaks into backend: {offenders}"
