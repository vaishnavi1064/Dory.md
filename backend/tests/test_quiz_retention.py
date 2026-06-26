"""Sprint 0 — Task 5 honesty fix: the quiz selects by TRUE Ebbinghaus retention,
not just the SQL last_accessed/access_count proxy.

This validates the Option B refactor actually changes behavior: a chunk that is
older by last_accessed but heavily reviewed (high stability) can still have decent
retention, while a newer-but-fragile chunk (no reviews, low complexity) has worse
true retention and must be quizzed first.
"""

from datetime import datetime, timedelta, timezone

from database.db import get_connection, insert_chunk


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import _get_secret, JWT_ALGORITHM
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def _set_state(chunk_id: str, last_accessed_iso: str, access_count: int) -> None:
    conn = get_connection()
    conn.execute(
        "UPDATE chunks SET last_accessed = ?, access_count = ? WHERE id = ?",
        (last_accessed_iso, access_count, chunk_id),
    )
    conn.commit()
    conn.close()


def test_quiz_uses_true_retention_not_just_recency(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    now = datetime.now(tz=timezone.utc)

    # Stalest by last_accessed (30 days) BUT heavily reviewed + complex → true
    # retention stays relatively high (~0.63).
    stale_strong = insert_chunk(
        content="stale but strongly reinforced concept",
        source_file="strong.md", complexity_score=1.0, user_id=uid,
    )
    _set_state(stale_strong, (now - timedelta(days=30)).isoformat(), access_count=200)

    # Newer (10 days) BUT never reviewed + simple → true retention is much worse (~0.11).
    fresh_fragile = insert_chunk(
        content="newer but fragile concept",
        source_file="fragile.md", complexity_score=0.0, user_id=uid,
    )
    _set_state(fresh_fragile, (now - timedelta(days=10)).isoformat(), access_count=0)

    res = client.post("/api/quiz/start", headers=h)
    assert res.status_code == 200, res.text
    ids = [q["chunk_id"] for q in res.json()["questions"]]

    # A pure last_accessed/access_count proxy would put `stale_strong` first.
    # True-retention ranking must put the fragile chunk first instead.
    assert ids[0] == fresh_fragile, ids
    assert ids.index(fresh_fragile) < ids.index(stale_strong)
