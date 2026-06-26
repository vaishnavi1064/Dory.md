"""Sprint 0 — account deletion + export (Task 4).

Covers GDPR-style hard deletion across all user-scoped tables + ChromaDB, data
export shape, idempotency, and rejection of a valid-but-stale (ghost-user) JWT.
"""

from database.db import get_connection, insert_chunk, update_chunk_access


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import _get_secret, JWT_ALGORITHM
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def _count(table: str, user_id: str) -> int:
    conn = get_connection()
    try:
        col = "id" if table == "users" else "user_id"
        return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (user_id,)).fetchone()[0]
    finally:
        conn.close()


def test_account_delete_removes_all_user_data(client, register_user, monkeypatch):
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    # Stub ChromaDB with a fake keyed by user_id so we can assert vector deletion
    # without touching the real on-disk collection.
    fake_vectors = {uid: ["v1", "v2"]}
    import routers.account as account_router
    monkeypatch.setattr(account_router, "chroma_delete_user", lambda u: fake_vectors.pop(u, None))

    # Seed every user-scoped table.
    c1 = insert_chunk(content="alpha", source_file="a.md", complexity_score=0.5, user_id=uid)
    insert_chunk(content="beta", source_file="b.md", complexity_score=0.5, user_id=uid)
    update_chunk_access(c1, uid, source="manual")          # access_log row
    assert client.post("/api/quiz/start", headers=h).status_code == 200  # quiz_sessions row
    # refresh_tokens row was created at registration.

    for table in ("chunks", "access_log", "quiz_sessions", "refresh_tokens", "users"):
        assert _count(table, uid) > 0, f"precondition: {table} should be seeded"

    res = client.delete("/api/account", headers=h)
    assert res.status_code == 204, res.text

    for table in ("chunks", "access_log", "quiz_sessions", "refresh_tokens", "users"):
        assert _count(table, uid) == 0, f"{table} not fully deleted"
    assert uid not in fake_vectors  # ChromaDB vectors gone


def test_account_delete_is_idempotent(client, register_user, monkeypatch):
    _, token = register_user()
    h = {"Authorization": f"Bearer {token}"}
    import routers.account as account_router
    monkeypatch.setattr(account_router, "chroma_delete_user", lambda u: None)

    assert client.delete("/api/account", headers=h).status_code == 204
    # The same JWT now points at a deleted user, so the auth dependency rejects it
    # with 401 (the ghost-user behavior) before the endpoint runs — a sensible
    # idempotent outcome.
    second = client.delete("/api/account", headers=h)
    assert second.status_code in (401, 404), second.text


def test_account_export_returns_user_data(client, register_user):
    user, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    insert_chunk(content="export me", source_file="e.md", complexity_score=0.5, user_id=uid)

    res = client.get("/api/account/export", headers=h)
    assert res.status_code == 200, res.text
    data = res.json()
    assert set(("format_version", "exported_at", "user", "chunks", "access_log",
                "quiz_sessions", "chunk_state_log", "meetings")).issubset(data.keys())
    assert data["user"]["id"] == uid
    assert "password_hash" not in data["user"]  # secret must not leak into export
    assert len(data["chunks"]) == 1
    assert "attachment" in res.headers.get("content-disposition", "")


def test_ghost_user_jwt_rejected(client, register_user, monkeypatch):
    _, token = register_user()
    h = {"Authorization": f"Bearer {token}"}
    import routers.account as account_router
    monkeypatch.setattr(account_router, "chroma_delete_user", lambda u: None)

    assert client.delete("/api/account", headers=h).status_code == 204
    # Same (now-stale) JWT on another authenticated endpoint must be cleanly
    # rejected with 401 — NOT a 500 KeyError and NOT silent success.
    res = client.get("/api/chunks", headers=h)
    assert res.status_code == 401, res.text
