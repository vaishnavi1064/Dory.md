"""Account export — full user-data payload shape and exclusions."""

import json
from datetime import datetime, timedelta, timezone

from database.db import get_connection, insert_chunk, insert_chunk_state_log, insert_meeting


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import JWT_ALGORITHM, _get_secret
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def _export(client, token: str) -> dict:
    res = client.get("/api/account/export", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    return res.json()


def _future_iso(hours: float = 24) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def test_export_includes_quiz_sessions(client, register_user):
    _, token = register_user("exp_quiz")
    h = {"Authorization": f"Bearer {token}"}

    start = client.post("/api/quiz/start", headers=h)
    assert start.status_code == 200
    body = start.json()
    session_id = body["session_id"]
    answers = [{"question_id": q["id"], "selected_index": 0, "time_taken_ms": 10} for q in body["questions"]]
    assert client.post(f"/api/quiz/{session_id}/submit", headers=h, json={"answers": answers}).status_code == 200

    data = _export(client, token)
    assert len(data["quiz_sessions"]) >= 1
    row = next(r for r in data["quiz_sessions"] if r["id"] == session_id)
    assert row["completed_at"] is not None
    assert "correct_count" in row


def test_export_includes_mood_logs(client, register_user):
    _, token = register_user("exp_mood")
    uid = _user_id_from(token)
    chunk_id = insert_chunk(content="m", source_file="m.md", complexity_score=0.5, user_id=uid)
    insert_chunk_state_log(chunk_id, uid, "calm", "create")

    data = _export(client, token)
    assert len(data["chunk_state_log"]) == 1
    assert data["chunk_state_log"][0]["mood"] == "calm"


def test_export_includes_meetings(client, register_user):
    _, token = register_user("exp_mtg")
    uid = _user_id_from(token)
    insert_meeting(uid, title="Export me", starts_at=_future_iso(), duration_minutes=30)

    data = _export(client, token)
    assert len(data["meetings"]) == 1
    assert data["meetings"][0]["title"] == "Export me"


def test_export_excludes_refresh_tokens(client, register_user):
    _, token = register_user("exp_rt")
    uid = _user_id_from(token)
    conn = get_connection()
    n = conn.execute("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?", (uid,)).fetchone()[0]
    conn.close()
    assert n > 0

    data = _export(client, token)
    assert "refresh_tokens" not in data


def test_export_excludes_password_hash(client, register_user):
    _, token = register_user("exp_pw")
    data = _export(client, token)
    assert "password_hash" not in data["user"]


def test_export_has_format_version(client, register_user):
    _, token = register_user("exp_ver")
    data = _export(client, token)
    assert data["format_version"] == "1.0"


def test_export_has_exported_at_timestamp(client, register_user):
    _, token = register_user("exp_ts")
    before = datetime.now(timezone.utc)
    data = _export(client, token)
    after = datetime.now(timezone.utc)
    exported = datetime.fromisoformat(data["exported_at"].replace("Z", "+00:00"))
    assert before - timedelta(seconds=1) <= exported <= after + timedelta(seconds=1)
