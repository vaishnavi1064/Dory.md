"""Retention half of spreading activation.

The stability half (Phase 2) only changes FSRS scheduling. These tests prove the
half that the rest of the product can actually see: a successful recall
partially refreshes its neighbours' Ebbinghaus *retention*, which is what search
ranking, the dashboard buckets, the fading feed and Time Machine all read.

The user-visible "last viewed" time must never move as a side effect — that is
asserted explicitly in test_last_accessed_is_never_falsified.
"""

from datetime import datetime, timedelta, timezone

from core import graph_edges
from database.db import get_chunk, get_connection, upsert_edge
from intelligence.memory import calculate_retention

from tests.test_graph_edges import _user_id_from, make_chunk, unit_vec

ALPHA = graph_edges.DEFAULT_SPREAD_ALPHA


def set_anchor(chunk_id: str, user_id: str, hours_ago: float) -> datetime:
    """Pin a chunk's retention anchor so its retention is exactly predictable."""
    when = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    conn = get_connection()
    conn.execute(
        "UPDATE chunks SET retention_anchor = ? WHERE id = ? AND user_id = ?",
        (when.isoformat(), chunk_id, user_id),
    )
    conn.commit()
    conn.close()
    return when


def anchor_of(chunk_id: str, user_id: str) -> datetime:
    row = get_chunk(chunk_id, user_id)
    return datetime.fromisoformat(row["retention_anchor"] or row["last_accessed"])


def retention_of(chunk_id: str, user_id: str) -> float:
    row = get_chunk(chunk_id, user_id)
    return calculate_retention(
        anchor_of(chunk_id, user_id), row["access_count"], row["complexity_score"]
    )


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def grade(client, token, chunk_id, value=4):
    return client.post(
        "/api/review/grade", headers=auth(token), json={"chunk_id": chunk_id, "grade": value}
    )


# -- The mechanism -----------------------------------------------------------

def test_successful_recall_raises_neighbor_retention(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    set_anchor(b, uid, hours_ago=240)

    before_anchor = anchor_of(b, uid)
    before_retention = retention_of(b, uid)

    res = grade(client, token, a, 4)
    assert res.status_code == 200, res.text

    after_anchor = anchor_of(b, uid)
    after_retention = retention_of(b, uid)

    assert after_anchor > before_anchor
    assert after_retention > before_retention

    # The anchor advanced s = weight * alpha of the way to now, and no further.
    now = datetime.now(timezone.utc)
    moved = (after_anchor - before_anchor).total_seconds()
    remaining = (now - before_anchor).total_seconds()
    assert 0.9 * ALPHA < moved / remaining < 1.1 * ALPHA
    assert after_anchor < now, "a neighbour must never look fully refreshed"


def test_edge_weight_scales_the_refresh(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a = make_chunk(uid, 0.0)
    strong, weak = make_chunk(uid, 0.1), make_chunk(uid, 0.2)
    upsert_edge(uid, a, strong, weight=1.0)
    upsert_edge(uid, a, weak, weight=0.25)
    for cid in (strong, weak):
        set_anchor(cid, uid, hours_ago=240)

    before = {cid: anchor_of(cid, uid) for cid in (strong, weak)}
    grade(client, token, a, 4)

    gain_strong = (anchor_of(strong, uid) - before[strong]).total_seconds()
    gain_weak = (anchor_of(weak, uid) - before[weak]).total_seconds()

    assert gain_strong > gain_weak > 0
    # Weight 1.0 vs 0.25 -> roughly a 4x difference in how far each advanced.
    assert 3.5 < gain_strong / gain_weak < 4.5


def test_every_passing_grade_refreshes_and_a_lapse_does_not(client, register_user):
    """Grades 2-4 mean the card was recalled; grade 1 (Again) is a lapse."""
    for grade_value, should_move in ((2, True), (3, True), (4, True), (1, False)):
        _, token = register_user(f"g{grade_value}")
        uid = _user_id_from(token)
        a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
        upsert_edge(uid, a, b, weight=1.0)
        set_anchor(b, uid, hours_ago=240)

        before = anchor_of(b, uid)
        grade(client, token, a, grade_value)
        after = anchor_of(b, uid)

        if should_move:
            assert after > before, f"grade {grade_value} should refresh neighbours"
        else:
            assert after == before, f"grade {grade_value} must not refresh neighbours"


def test_failed_recall_changes_no_neighbor_retention(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    set_anchor(b, uid, hours_ago=240)

    before_anchor, before_retention = anchor_of(b, uid), retention_of(b, uid)
    res = grade(client, token, a, 1)

    assert res.status_code == 200
    assert anchor_of(b, uid) == before_anchor
    # Retention is computed against wall-clock now, so it can only drift down a
    # sliver between the two calls; what matters is that nothing refreshed it.
    assert retention_of(b, uid) <= before_retention


def test_chunk_with_no_edges_refreshes_nothing(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, lonely = make_chunk(uid, 0.0), make_chunk(uid, 1.5)
    before = set_anchor(lonely, uid, hours_ago=240)

    grade(client, token, a, 4)

    assert anchor_of(lonely, uid) == before


def test_refresh_is_single_hop(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b, c = make_chunk(uid, 0.0), make_chunk(uid, 0.1), make_chunk(uid, 0.2)
    upsert_edge(uid, a, b, weight=1.0)
    upsert_edge(uid, b, c, weight=1.0)
    before_b, before_c = set_anchor(b, uid, 240), set_anchor(c, uid, 240)

    grade(client, token, a, 4)

    assert anchor_of(b, uid) > before_b
    assert anchor_of(c, uid) == before_c


def test_alpha_zero_disables_the_refresh(client, register_user, monkeypatch):
    monkeypatch.setenv("SPREAD_ALPHA", "0")
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    before = set_anchor(b, uid, hours_ago=240)

    grade(client, token, a, 4)

    assert anchor_of(b, uid) == before


# -- The gap this closes: retention is visible where stability was not --------

def test_refresh_moves_a_neighbor_into_a_higher_graph_bucket(client, register_user):
    """The decisive test: GET /api/graph reports a different bucket afterwards.

    b is pinned just below the 0.8 strong threshold. One successful recall of its
    neighbour lifts it across. Raising fsrs_stability alone could never do this.
    """
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    # 67h with access_count 0 and complexity 0.5 gives R ~ 0.78 (fading).
    set_anchor(b, uid, hours_ago=67)

    def bucket_of(chunk_id):
        body = client.get("/api/graph", headers=auth(token)).json()
        return next(n["bucket"] for n in body["nodes"] if n["id"] == chunk_id)

    assert bucket_of(b) == "fading"

    res = grade(client, token, a, 4)
    assert res.status_code == 200

    assert bucket_of(b) == "strong", "the refresh must be visible in the graph API"


def test_refresh_changes_search_ranking(client, register_user, monkeypatch):
    """Two chunks with identical similarity and retention rank equally; after one
    is refreshed its decay urgency drops, so the untouched one outranks it."""
    import routers.search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda _q: unit_vec(0.05))

    _, token = register_user()
    uid = _user_id_from(token)
    # x and y share a vector, so similarity is identical by construction.
    x, y = make_chunk(uid, 0.05, content="shared vector x"), make_chunk(uid, 0.05, content="shared vector y")
    reviewer = make_chunk(uid, 1.4, content="the note being reviewed")
    upsert_edge(uid, reviewer, y, weight=1.0)
    for cid in (x, y):
        set_anchor(cid, uid, hours_ago=120)

    def scores():
        body = client.post("/api/search", headers=auth(token), json={"context": "anything"}).json()
        return {r["chunk_id"]: r for r in body["results"]}

    before = scores()
    assert abs(before[x]["relevance_score"] - before[y]["relevance_score"]) < 1e-9
    assert abs(before[x]["retention"] - before[y]["retention"]) < 1e-9

    res = grade(client, token, reviewer, 4)
    assert res.status_code == 200

    after = scores()
    assert after[y]["retention"] > after[x]["retention"], "y's retention should have risen"
    # decay_urgency = 1 - retention, so a refreshed note is now less urgent.
    assert after[y]["relevance_score"] < after[x]["relevance_score"]

    body = client.post("/api/search", headers=auth(token), json={"context": "anything"}).json()
    order = [r["chunk_id"] for r in body["results"]]
    assert order.index(x) < order.index(y), "the un-refreshed note now ranks higher"


def test_refresh_is_visible_in_the_fading_feed(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    set_anchor(b, uid, hours_ago=240)

    def fading_retention():
        body = client.get("/api/fading?limit=50", headers=auth(token)).json()
        return next((c["retention"] for c in body["chunks"] if c["chunk_id"] == b), None)

    before = fading_retention()
    grade(client, token, a, 4)
    after = fading_retention()

    assert before is not None and after is not None
    assert after > before


# -- The honesty guarantee ---------------------------------------------------

def test_last_accessed_is_never_falsified(client, register_user):
    """A neighbour's retention moves, but its user-visible "last viewed" must not.

    last_accessed is rendered as a literal timestamp next to a clock icon and
    drives the Library "recent" sort, so spreading activation writes only the
    separate retention_anchor column.
    """
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=1.0)
    set_anchor(b, uid, hours_ago=240)

    before_row = get_chunk(b, uid)
    before_last_accessed = before_row["last_accessed"]
    before_access_count = before_row["access_count"]
    before_anchor = anchor_of(b, uid)

    grade(client, token, a, 4)

    after_row = get_chunk(b, uid)
    assert anchor_of(b, uid) > before_anchor, "the anchor did move"
    assert after_row["last_accessed"] == before_last_accessed, "last viewed must not move"
    assert after_row["access_count"] == before_access_count, "the note was not actually read"


def test_direct_review_still_moves_both(client, register_user):
    """A real review of a chunk refreshes it fully: anchor and last_accessed."""
    _, token = register_user()
    uid = _user_id_from(token)
    a = make_chunk(uid, 0.0)
    set_anchor(a, uid, hours_ago=240)
    before = get_chunk(a, uid)

    grade(client, token, a, 4)

    after = get_chunk(a, uid)
    assert after["last_accessed"] > before["last_accessed"]
    assert anchor_of(a, uid) > datetime.fromisoformat(before["retention_anchor"])
    assert after["access_count"] == before["access_count"] + 1


# -- Per-user isolation ------------------------------------------------------

def test_refresh_never_touches_another_users_chunk(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)

    a1, a2 = make_chunk(uid_a, 0.0), make_chunk(uid_a, 0.1)
    b1 = make_chunk(uid_b, 0.0)
    upsert_edge(uid_a, a1, a2, weight=1.0)
    before_a2 = set_anchor(a2, uid_a, hours_ago=240)
    before_b1 = set_anchor(b1, uid_b, hours_ago=240)

    res = grade(client, token_a, a1, 4)

    assert res.status_code == 200
    assert anchor_of(a2, uid_a) > before_a2, "A's own neighbour moved"
    assert anchor_of(b1, uid_b) == before_b1, "B's chunk must be untouched"
    b1_row = get_chunk(b1, uid_b)
    assert b1_row["access_count"] == 0 and b1_row["fsrs_stability"] is None


def test_anchor_write_is_scoped_by_user_id(client, register_user):
    """A forged neighbour id from another account matches no row."""
    from database.db import apply_fsrs_update_with_propagation

    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)
    a = make_chunk(uid_a, 0.0)
    b = make_chunk(uid_b, 0.0)
    before_b = set_anchor(b, uid_b, hours_ago=240)

    ok = apply_fsrs_update_with_propagation(
        a,
        uid_a,
        {
            "fsrs_state": 2, "fsrs_step": 0, "fsrs_stability": 2.0,
            "fsrs_difficulty": 5.0, "fsrs_due": "2026-02-01T00:00:00+00:00",
            "fsrs_last_review": "2026-01-01T00:00:00+00:00",
        },
        None,
        {b: datetime.now(timezone.utc).isoformat()},
    )

    assert ok is True
    assert anchor_of(b, uid_b) == before_b, "another user's anchor must be unreachable"
