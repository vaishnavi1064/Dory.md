"""Regression tests for the AUDIT P0 fixes.

- P0-1: editing a chunk re-embeds it (vector store stays in sync with content).
- P0-2: a submitted quiz session is marked completed and appears in history.
- P0-4: /quiz/answer scores against the server-side answer key, never the client.
"""

from database.db import get_chunk, insert_chunk


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import _get_secret, JWT_ALGORITHM
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


# ── P0-1: re-index on edit ────────────────────────────────────────────────────

def test_edit_reembeds_chunk(client, register_user, monkeypatch):
    """A successful content edit must recompute the embedding and upsert it.
    We stub the heavy embedding model and capture the vector store call."""
    _, token = register_user()
    uid = _user_id_from(token)
    cid = insert_chunk(content="original text", source_file="note.md", complexity_score=0.5, user_id=uid)

    captured = {}

    import intelligence.embeddings as embeddings
    import routers.chunks as chunks_router

    monkeypatch.setattr(embeddings, "embed_query", lambda text: [0.123] * 384)

    def fake_upsert(chunk_id, embedding, metadata):
        captured["chunk_id"] = chunk_id
        captured["embedding"] = embedding
        captured["metadata"] = metadata

    monkeypatch.setattr(chunks_router, "chroma_upsert", fake_upsert)

    res = client.put(
        f"/api/chunks/{cid}",
        headers={"Authorization": f"Bearer {token}"},
        json={"content": "completely different meaning now"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["reindexed"] is True

    # The vector store was updated for THIS chunk with the new embedding + owner.
    assert captured["chunk_id"] == cid
    assert captured["embedding"] == [0.123] * 384
    assert captured["metadata"]["user_id"] == uid
    assert captured["metadata"]["source_file"] == "note.md"

    # And SQLite reflects the new content.
    assert get_chunk(cid, uid)["content"] == "completely different meaning now"


def test_edit_other_users_chunk_does_not_reembed(client, register_user, monkeypatch):
    """Cross-user edit 404s BEFORE any embedding work happens."""
    _, alice = register_user("alice")
    _, bob = register_user("bob")
    alice_id = _user_id_from(alice)
    cid = insert_chunk(content="alice", source_file="a.md", complexity_score=0.5, user_id=alice_id)

    import routers.chunks as chunks_router
    called = {"n": 0}
    monkeypatch.setattr(chunks_router, "_reindex_chunk", lambda *a, **k: called.__setitem__("n", called["n"] + 1))

    res = client.put(f"/api/chunks/{cid}", headers={"Authorization": f"Bearer {bob}"}, json={"content": "x"})
    assert res.status_code == 404
    assert called["n"] == 0


# ── P0-2: quiz session completion + history ──────────────────────────────────

def test_quiz_history_starts_empty_and_requires_auth(client, register_user):
    res = client.get("/api/quiz/history")
    assert res.status_code == 401

    _, token = register_user()
    res = client.get("/api/quiz/history", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["sessions"] == []


def test_submitting_quiz_records_completed_session(client, register_user):
    _, token = register_user()
    h = {"Authorization": f"Bearer {token}"}

    start = client.post("/api/quiz/start", headers=h)
    assert start.status_code == 200
    body = start.json()
    session_id = body["session_id"]
    answers = [{"question_id": q["id"], "selected_index": 0, "time_taken_ms": 10} for q in body["questions"]]

    submit = client.post(f"/api/quiz/{session_id}/submit", headers=h, json={"answers": answers})
    assert submit.status_code == 200

    hist = client.get("/api/quiz/history", headers=h).json()["sessions"]
    assert len(hist) == 1
    assert hist[0]["session_id"] == session_id
    assert hist[0]["completed_at"] is not None


# ── P0-4: server-authoritative answer scoring ────────────────────────────────

def test_quiz_answer_ignores_client_supplied_correct_index(client, register_user):
    """The client cannot declare its own correct answer. The server's session map
    is the only source of truth for correctness."""
    _, token = register_user()
    h = {"Authorization": f"Bearer {token}"}

    body = client.post("/api/quiz/start", headers=h).json()
    session_id = body["session_id"]
    q0 = body["questions"][0]
    # The response no longer carries the answer (that is the point of
    # test_quiz_start_does_not_ship_the_answer_key), so read it from the only
    # place it exists: the server's session map.
    from routers.quiz import _session_store
    server_correct = _session_store[session_id][q0["chunk_id"]]["correct_index"]

    # Send the genuinely-correct selection but LIE about correct_index (99).
    res = client.post(
        "/api/quiz/answer",
        headers=h,
        json={
            "session_id": session_id,
            "chunk_id": q0["id"],
            "selected_index": server_correct,
            "correct_index": 99,  # forged — must be ignored
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["correct"] is True, "server should mark a genuinely-correct answer correct"
    assert data["correct_index"] == server_correct, "server must return its own correct_index, not the forged 99"


# -- Answer-key disclosure -----------------------------------------------------

def test_quiz_start_does_not_ship_the_answer_key(client, register_user):
    """The key must stay server-side until the session is submitted.

    Scoring was already server-authoritative (a client cannot forge a correct
    answer), but /quiz/start used to return correct_index on every question, so
    the answers were readable in devtools before choosing one.
    """
    _, token = register_user()
    res = client.post("/api/quiz/start", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200

    body = res.json()
    assert body["questions"], "no questions to check"
    for question in body["questions"]:
        assert "correct_index" not in question, (
            f"answer key leaked in /quiz/start: {sorted(question)}"
        )
    # Belt and braces: no answer-shaped key anywhere in the serialized payload.
    assert "correct_index" not in res.text


def test_quiz_submit_still_returns_the_answers_afterwards(client, register_user):
    """Revealing at the end is the point — the results screen needs the key."""
    _, token = register_user()
    auth = {"Authorization": f"Bearer {token}"}
    start = client.post("/api/quiz/start", headers=auth).json()

    answers = [
        {"question_id": q["id"], "selected_index": 0, "time_taken_ms": 100}
        for q in start["questions"]
    ]
    res = client.post(
        f"/api/quiz/{start['session_id']}/submit", json={"answers": answers}, headers=auth
    )
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == len(answers)
    for item in results:
        assert isinstance(item["correct_index"], int)


def test_quiz_answer_works_without_a_client_supplied_key(client, register_user):
    """The client can no longer send correct_index; the server must not need it."""
    _, token = register_user()
    auth = {"Authorization": f"Bearer {token}"}
    start = client.post("/api/quiz/start", headers=auth).json()
    question = start["questions"][0]

    res = client.post(
        "/api/quiz/answer",
        json={
            "session_id": start["session_id"],
            "chunk_id": question["chunk_id"],
            "selected_index": 0,
        },
        headers=auth,
    )
    assert res.status_code == 200, res.text
    assert isinstance(res.json()["correct"], bool)
