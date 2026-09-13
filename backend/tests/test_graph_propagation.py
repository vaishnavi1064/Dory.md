"""Phase 2 - spreading activation through POST /api/review/grade.

Reviewing a chunk shares a damped slice of its FSRS stability gain with its
graph neighbours. Chunks are given an explicit FSRS state up front so a review
produces a real, measurable gain rather than the undefined first-review case.
"""

import math
from datetime import datetime

from core import graph_edges
from database.db import (
    apply_fsrs_update_with_propagation,
    get_chunk,
    upsert_edge,
)

from tests.test_graph_edges import _user_id_from, make_chunk

ALPHA = graph_edges.DEFAULT_SPREAD_ALPHA


def seed_fsrs(chunk_id: str, user_id: str, stability: float, difficulty: float = 5.0) -> None:
    """Give a chunk a prior FSRS state so its next grade yields a real delta-S."""
    apply_fsrs_update_with_propagation(
        chunk_id,
        user_id,
        {
            "fsrs_state": 2,
            "fsrs_step": 0,
            "fsrs_stability": stability,
            "fsrs_difficulty": difficulty,
            "fsrs_due": "2026-01-01T00:00:00+00:00",
            "fsrs_last_review": "2025-12-01T00:00:00+00:00",
        },
        None,
    )


def stability_of(chunk_id: str, user_id: str):
    return get_chunk(chunk_id, user_id)["fsrs_stability"]


def anchor_of(chunk_id: str, user_id: str):
    """The timestamp retention decays from — distinct from last_accessed."""
    row = get_chunk(chunk_id, user_id)
    return datetime.fromisoformat(row["retention_anchor"] or row["last_accessed"])


def grade(client, token, chunk_id, value=4):
    return client.post(
        "/api/review/grade",
        headers={"Authorization": f"Bearer {token}"},
        json={"chunk_id": chunk_id, "grade": value},
    )


# -- The core mechanism ------------------------------------------------------

def test_review_raises_linked_neighbor_stability_by_expected_amount(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=0.8)
    seed_fsrs(a, uid, stability=2.0)
    seed_fsrs(b, uid, stability=5.0)

    before_a, before_b = stability_of(a, uid), stability_of(b, uid)
    res = grade(client, token, a, 4)
    assert res.status_code == 200, res.text

    gain = res.json()["stability"] - before_a
    assert gain > 0, "grade 4 on a due card should raise stability"
    assert res.json()["reinforced_neighbor_count"] == 1

    expected = before_b + gain * 0.8 * ALPHA
    assert math.isclose(stability_of(b, uid), expected, rel_tol=1e-6)


def test_edge_weight_scales_the_share(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a = make_chunk(uid, 0.0)
    strong, weak = make_chunk(uid, 0.1), make_chunk(uid, 0.2)
    upsert_edge(uid, a, strong, weight=1.0)
    upsert_edge(uid, a, weak, weight=0.25)
    for cid in (a, strong, weak):
        seed_fsrs(cid, uid, stability=4.0)

    before = stability_of(a, uid)
    res = grade(client, token, a, 4)
    gain = res.json()["stability"] - before

    assert res.json()["reinforced_neighbor_count"] == 2
    assert math.isclose(stability_of(strong, uid), 4.0 + gain * 1.0 * ALPHA, rel_tol=1e-6)
    assert math.isclose(stability_of(weak, uid), 4.0 + gain * 0.25 * ALPHA, rel_tol=1e-6)


def test_chunk_with_no_edges_reinforces_nothing(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, lonely = make_chunk(uid, 0.0), make_chunk(uid, 1.5)
    seed_fsrs(a, uid, stability=2.0)
    seed_fsrs(lonely, uid, stability=3.0)

    res = grade(client, token, a, 4)

    assert res.status_code == 200
    assert res.json()["reinforced_neighbor_count"] == 0
    assert stability_of(lonely, uid) == 3.0


def test_first_review_spreads_retention_but_not_stability(client, register_user):
    """The two halves of spreading activation fire on different triggers.

    A never-graded chunk has no prior stability, so there is no gain to share —
    but the recall still succeeded, so the retention half does move. This is the
    case that makes the feature visible on a corpus that has never been graded.
    """
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    assert stability_of(a, uid) is None

    before_anchor = anchor_of(b, uid)
    res = grade(client, token, a, 4)

    assert res.status_code == 200
    assert stability_of(b, uid) is None, "no stability gain to propagate on a first review"
    assert anchor_of(b, uid) > before_anchor, "retention still refreshes on a first pass"
    assert res.json()["reinforced_neighbor_count"] == 1


def test_failed_review_does_not_reduce_neighbors(client, register_user):
    """Grade 1 lowers the reviewed chunk's stability; neighbours are untouched."""
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    seed_fsrs(a, uid, stability=10.0)
    seed_fsrs(b, uid, stability=6.0)

    res = grade(client, token, a, 1)

    assert res.status_code == 200
    assert res.json()["stability"] < 10.0, "grade 1 should lower stability"
    assert res.json()["reinforced_neighbor_count"] == 0
    assert stability_of(b, uid) == 6.0


def test_propagation_is_single_hop(client, register_user):
    """a-b-c: reviewing a reinforces b but must not reach c."""
    _, token = register_user()
    uid = _user_id_from(token)
    a, b, c = make_chunk(uid, 0.0), make_chunk(uid, 0.1), make_chunk(uid, 0.2)
    upsert_edge(uid, a, b, weight=1.0)
    upsert_edge(uid, b, c, weight=1.0)
    for cid in (a, b, c):
        seed_fsrs(cid, uid, stability=4.0)

    res = grade(client, token, a, 4)

    assert res.json()["reinforced_neighbor_count"] == 1
    assert stability_of(b, uid) > 4.0
    assert stability_of(c, uid) == 4.0


def test_neighbor_with_no_prior_stability_is_reinforced_from_zero(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    seed_fsrs(a, uid, stability=3.0)
    assert stability_of(b, uid) is None

    before = stability_of(a, uid)
    res = grade(client, token, a, 4)
    gain = res.json()["stability"] - before

    assert res.json()["reinforced_neighbor_count"] == 1
    assert math.isclose(stability_of(b, uid), gain * ALPHA, rel_tol=1e-6)


def test_alpha_zero_disables_propagation(client, register_user, monkeypatch):
    monkeypatch.setenv("SPREAD_ALPHA", "0")
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    seed_fsrs(a, uid, stability=2.0)
    seed_fsrs(b, uid, stability=7.0)

    res = grade(client, token, a, 4)

    assert res.json()["reinforced_neighbor_count"] == 0
    assert stability_of(b, uid) == 7.0


# -- Per-user isolation ------------------------------------------------------

def test_review_never_touches_another_users_chunk(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)

    a1, a2 = make_chunk(uid_a, 0.0), make_chunk(uid_a, 0.1)
    b1 = make_chunk(uid_b, 0.0)
    upsert_edge(uid_a, a1, a2, weight=1.0)
    for cid, uid in ((a1, uid_a), (a2, uid_a), (b1, uid_b)):
        seed_fsrs(cid, uid, stability=4.0)

    res = grade(client, token_a, a1, 4)

    assert res.status_code == 200
    assert res.json()["reinforced_neighbor_count"] == 1
    assert stability_of(a2, uid_a) > 4.0      # A's own neighbour moved
    assert stability_of(b1, uid_b) == 4.0     # B's chunk did not


def test_propagation_write_is_scoped_by_user_id(client, register_user):
    """Even a forged neighbour id from another account matches no row."""
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)
    a = make_chunk(uid_a, 0.0)
    b = make_chunk(uid_b, 0.0)
    seed_fsrs(a, uid_a, stability=1.0)
    seed_fsrs(b, uid_b, stability=9.0)

    ok = apply_fsrs_update_with_propagation(
        a,
        uid_a,
        {
            "fsrs_state": 2, "fsrs_step": 0, "fsrs_stability": 2.0,
            "fsrs_difficulty": 5.0, "fsrs_due": "2026-02-01T00:00:00+00:00",
            "fsrs_last_review": "2026-01-01T00:00:00+00:00",
        },
        {b: 999.0},
    )

    assert ok is True
    assert stability_of(a, uid_a) == 2.0
    assert stability_of(b, uid_b) == 9.0, "another user's chunk must be unreachable"


def test_grading_another_users_chunk_is_404(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_b = _user_id_from(token_b)
    b = make_chunk(uid_b, 0.0)
    seed_fsrs(b, uid_b, stability=5.0)

    res = grade(client, token_a, b, 4)

    assert res.status_code == 404
    assert stability_of(b, uid_b) == 5.0


# -- Transaction integrity ---------------------------------------------------

def test_missing_chunk_writes_nothing(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    b = make_chunk(uid, 0.1)
    seed_fsrs(b, uid, stability=5.0)

    ok = apply_fsrs_update_with_propagation(
        "does-not-exist",
        uid,
        {
            "fsrs_state": 2, "fsrs_step": 0, "fsrs_stability": 1.0,
            "fsrs_difficulty": 5.0, "fsrs_due": "2026-02-01T00:00:00+00:00",
            "fsrs_last_review": "2026-01-01T00:00:00+00:00",
        },
        {b: 42.0},
    )

    assert ok is False
    assert stability_of(b, uid) == 5.0, "neighbour must not move when the review fails"
