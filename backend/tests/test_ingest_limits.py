"""Ingest upload limits — file count and size caps at POST /api/ingest."""

import io

import routers.ingest as ingest_router
from routers.ingest import MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import JWT_ALGORITHM, _get_secret
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def _make_file(name: str, size: int) -> tuple[str, tuple[str, io.BytesIO, str]]:
    return ("files", (name, io.BytesIO(b"x" * size), "text/plain"))


def test_rejects_too_many_files(client, register_user, monkeypatch):
    _, token = register_user("ing_lim_cnt")
    h = {"Authorization": f"Bearer {token}"}
    monkeypatch.setattr(ingest_router, "embed_texts", lambda chunks: [[0.1] * 384 for _ in chunks])
    monkeypatch.setattr(ingest_router, "add_chunks", lambda *a, **k: None)

    files = [_make_file(f"f{i}.txt", 64) for i in range(MAX_FILES + 1)]
    res = client.post("/api/ingest", headers=h, files=files)
    assert res.status_code == 400
    assert "max 20" in res.json()["detail"].lower()


def test_rejects_oversized_file(client, register_user):
    _, token = register_user("ing_lim_big")
    h = {"Authorization": f"Bearer {token}"}

    res = client.post(
        "/api/ingest",
        headers=h,
        files=[_make_file("big.txt", MAX_FILE_BYTES + 1)],
    )
    assert res.status_code == 400
    assert "10mb" in res.json()["detail"].lower()


def test_rejects_oversized_batch(client, register_user):
    _, token = register_user("ing_lim_batch")
    h = {"Authorization": f"Bearer {token}"}

    # Many small files (each under MAX_FILE_BYTES) whose total exceeds MAX_TOTAL_BYTES.
    file_size = MAX_FILE_BYTES // 4  # 2.5 MB each
    file_count = (MAX_TOTAL_BYTES // file_size) + 2
    assert file_count <= MAX_FILES, "test setup: adjust file_size if MAX_FILES is lowered"
    res = client.post(
        "/api/ingest",
        headers=h,
        files=[_make_file(f"b{i}.txt", file_size) for i in range(file_count)],
    )
    assert res.status_code == 400
    assert "20mb" in res.json()["detail"].lower()


def test_accepts_at_limit(client, register_user, monkeypatch):
    _, token = register_user("ing_lim_ok")
    h = {"Authorization": f"Bearer {token}"}
    monkeypatch.setattr(ingest_router, "embed_texts", lambda chunks: [[0.1] * 384 for _ in chunks])
    monkeypatch.setattr(ingest_router, "add_chunks", lambda *a, **k: None)

    # MAX_FILES files, each 1 byte — well within per-file and total caps.
    content = b"A sentence worth remembering. And a second one for good measure."
    files = [
        ("files", (f"ok{i}.txt", io.BytesIO(content), "text/plain"))
        for i in range(MAX_FILES)
    ]
    res = client.post("/api/ingest", headers=h, files=files)
    assert res.status_code == 200, res.text
