"""Sprint 0 — dual-write / dual-delete integrity (Task 3).

- Ingest must roll back its SQLite rows if the vector store write fails, so we
  never leave chunks without embeddings (orphans).
- Single delete must surface a vector-store failure as a 500 instead of silently
  swallowing it.
- Bulk delete must report partial failures in a structured body.
"""

from database.db import get_all_chunks, insert_chunk


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import _get_secret, JWT_ALGORITHM
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def test_ingest_rolls_back_sqlite_when_chroma_fails(client, register_user, monkeypatch):
    """If add_chunks (vector store) raises, the SQLite chunks inserted in the same
    request must be deleted — no orphan rows left behind."""
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    import routers.ingest as ingest_router

    # Stub the heavy embedder so the test doesn't need the ML stack.
    monkeypatch.setattr(ingest_router, "embed_texts", lambda chunks: [[0.1] * 384 for _ in chunks])

    def boom(*args, **kwargs):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(ingest_router, "add_chunks", boom)

    assert len(get_all_chunks(uid)) == 0

    res = client.post(
        "/api/ingest/text",
        headers=h,
        json={"content": "A sentence worth remembering. And a second one for good measure."},
    )

    assert res.status_code == 500, res.text
    # The rollback must have removed every row inserted before the failure.
    assert len(get_all_chunks(uid)) == 0


def test_ingest_partial_batch_returns_structured_failure(client, register_user, monkeypatch):
    """Batch ingest is per-file atomic: when file 2 of 3 fails the vector store
    write, file 1 stays ingested, file 2 is rolled back, file 3 is skipped — and
    the 500 body reports all three states."""
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    import routers.ingest as ingest_router

    monkeypatch.setattr(ingest_router, "embed_texts", lambda chunks: [[0.1] * 384 for _ in chunks])

    # add_chunks is called once per file; fail only on the 2nd call.
    calls = {"n": 0}

    def flaky(chunk_ids, embeddings, metadatas):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("chroma down")
        # 1st (and any later) call: succeed as a no-op.

    monkeypatch.setattr(ingest_router, "add_chunks", flaky)

    files = [
        ("files", ("alpha.txt", b"Alpha content sentence one. Sentence two here.", "text/plain")),
        ("files", ("report.txt", b"Report content sentence. More report text here.", "text/plain")),
        ("files", ("ideas.txt", b"Ideas content sentence. Another idea written here.", "text/plain")),
    ]
    res = client.post("/api/ingest", files=files, headers=h)

    assert res.status_code == 500, res.text
    data = res.json()

    # File 1 succeeded → its chunk ids are reported as ingested.
    assert len(data["ingested"]) >= 1
    # File 2 failed and was rolled back.
    assert data["failed"]["filename"] == "report.txt"
    assert "reason" in data["failed"]
    assert len(data["failed"]["rolled_back_chunk_ids"]) >= 1
    # File 3 was never processed.
    assert data["skipped_files"] == ["ideas.txt"]
    assert "message" in data

    # Only file 1's chunks survive in SQLite (file 2 rolled back, file 3 skipped).
    assert len(get_all_chunks(uid)) == len(data["ingested"])


def test_delete_chunk_returns_500_on_chroma_failure(client, register_user, monkeypatch):
    """A vector-store delete failure after the SQLite row is gone must propagate as
    a 500, not be swallowed into a fake success."""
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    cid = insert_chunk(content="to delete", source_file="n.md", complexity_score=0.5, user_id=uid)

    import routers.chunks as chunks_router

    def boom(chunk_id, user_id):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(chunks_router, "chroma_delete", boom)

    res = client.delete(f"/api/chunks/{cid}", headers=h)
    assert res.status_code == 500, res.text
    assert "Partial delete" in res.json()["detail"]


def test_bulk_delete_returns_partial_failure_body(client, register_user, monkeypatch):
    """When some vector-store deletes fail, the response is 500 with a structured
    body listing what was deleted and what failed."""
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    good = insert_chunk(content="good", source_file="g.md", complexity_score=0.5, user_id=uid)
    bad = insert_chunk(content="bad", source_file="b.md", complexity_score=0.5, user_id=uid)

    import routers.chunks as chunks_router

    def selective(chunk_id, user_id):
        if chunk_id == bad:
            raise RuntimeError("chroma down for this one")
        # good chunk: succeed (no-op)

    monkeypatch.setattr(chunks_router, "chroma_delete", selective)

    res = client.post("/api/chunks/bulk-delete", headers=h, json={"chunk_ids": [good, bad]})
    assert res.status_code == 500, res.text
    data = res.json()
    assert data["deleted"] == [good]
    assert len(data["failed"]) == 1
    assert data["failed"][0]["chunk_id"] == bad
    assert "reason" in data["failed"][0]
    assert "message" in data
