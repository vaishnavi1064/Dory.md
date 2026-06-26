"""Sprint: Mood tagging Phase 1 — log, history, stats, account-delete cleanup."""

from database.db import get_connection, insert_chunk, insert_chunk_state_log


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import JWT_ALGORITHM, _get_secret
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def _count_mood_logs(user_id: str) -> int:
    conn = get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) FROM chunk_state_log WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
    finally:
        conn.close()


def test_log_mood_creates_entry(client, register_user):
    _, token = register_user("mood_create")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    chunk_id = insert_chunk(content="mood note", source_file="m.md", complexity_score=0.5, user_id=uid)

    res = client.post("/api/mood/log", headers=h, json={
        "chunk_id": chunk_id,
        "mood": "focused",
        "event_type": "create",
    })
    assert res.status_code == 201, res.text
    assert res.json()["id"] >= 1
    assert _count_mood_logs(uid) == 1


def test_mood_log_manual_no_chunk_id(client, register_user):
    _, token = register_user("mood_manual")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    res = client.post("/api/mood/log", headers=h, json={
        "mood": "calm",
        "event_type": "create",
    })
    assert res.status_code == 201, res.text
    assert res.json()["id"] >= 1
    assert _count_mood_logs(uid) == 1

    hist = client.get("/api/mood/history", headers=h)
    assert hist.status_code == 200
    entry = hist.json()["entries"][0]
    assert entry["chunk_id"] is None
    assert entry["mood"] == "calm"

    stats = client.get("/api/mood/stats?days=30", headers=h)
    assert stats.status_code == 200
    assert stats.json()["total_logs"] == 1
    assert stats.json()["mood_counts"]["calm"] == 1


def test_log_mood_rejects_invalid_mood(client, register_user):
    _, token = register_user("mood_bad")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    chunk_id = insert_chunk(content="x", source_file="x.md", complexity_score=0.5, user_id=uid)

    res = client.post("/api/mood/log", headers=h, json={
        "chunk_id": chunk_id,
        "mood": "happy",
        "event_type": "create",
    })
    assert res.status_code == 400


def test_log_mood_rejects_invalid_event_type(client, register_user):
    _, token = register_user("mood_evt")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    chunk_id = insert_chunk(content="x", source_file="x.md", complexity_score=0.5, user_id=uid)

    res = client.post("/api/mood/log", headers=h, json={
        "chunk_id": chunk_id,
        "mood": "focused",
        "event_type": "clicked",
    })
    assert res.status_code == 400


def test_log_mood_rejects_other_users_chunk(client, register_user):
    _, token_a = register_user("mood_a")
    _, token_b = register_user("mood_b")
    uid_a = _user_id_from(token_a)
    chunk_id = insert_chunk(content="private", source_file="p.md", complexity_score=0.5, user_id=uid_a)

    res = client.post("/api/mood/log", headers={"Authorization": f"Bearer {token_b}"}, json={
        "chunk_id": chunk_id,
        "mood": "focused",
        "event_type": "review",
    })
    assert res.status_code == 404


def test_get_mood_history_returns_user_data_only(client, register_user):
    _, token_a = register_user("hist_a")
    _, token_b = register_user("hist_b")
    uid_a = _user_id_from(token_a)
    chunk_id = insert_chunk(content="mine", source_file="m.md", complexity_score=0.5, user_id=uid_a)
    insert_chunk_state_log(chunk_id, uid_a, "calm", "create")

    res_a = client.get("/api/mood/history", headers={"Authorization": f"Bearer {token_a}"})
    assert res_a.status_code == 200
    assert len(res_a.json()["entries"]) == 1

    res_b = client.get("/api/mood/history", headers={"Authorization": f"Bearer {token_b}"})
    assert res_b.status_code == 200
    assert len(res_b.json()["entries"]) == 0


def test_get_mood_stats_aggregates_correctly(client, register_user):
    _, token = register_user("stats")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    chunk_id = insert_chunk(content="stats", source_file="s.md", complexity_score=0.5, user_id=uid)

    moods = [
        ("focused", "create"),
        ("focused", "create"),
        ("tired", "review"),
        ("calm", "quiz"),
        ("frustrated", "quiz"),
    ]
    for mood, event_type in moods:
        insert_chunk_state_log(chunk_id, uid, mood, event_type)

    res = client.get("/api/mood/stats?days=30", headers=h)
    assert res.status_code == 200
    data = res.json()
    assert data["total_logs"] == 5
    assert data["mood_counts"]["focused"] == 2
    assert data["mood_counts"]["tired"] == 1
    assert data["event_counts"]["create"] == 2
    assert data["event_counts"]["review"] == 1
    assert data["event_counts"]["quiz"] == 2
    assert data["mood_by_event"]["create"]["focused"] == 2


def test_account_delete_wipes_mood_logs(client, register_user, monkeypatch):
    _, token = register_user("mood_del")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    chunk_id = insert_chunk(content="del", source_file="d.md", complexity_score=0.5, user_id=uid)
    insert_chunk_state_log(chunk_id, uid, "neutral", "create")
    assert _count_mood_logs(uid) == 1

    import routers.account as account_router
    monkeypatch.setattr(account_router, "chroma_delete_user", lambda u: None)

    assert client.delete("/api/account", headers=h).status_code == 204
    assert _count_mood_logs(uid) == 0
