"""Sprint: Manual meeting calendar — CRUD, validation, account-delete cleanup."""

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from database.db import count_meetings, get_connection, insert_meeting


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import JWT_ALGORITHM, _get_secret
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def _future_iso(hours: float = 24) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _past_iso(hours: float = 2) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def test_create_meeting_succeeds(client, register_user):
    _, token = register_user("mtg_create")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    payload = {
        "title": "Standup",
        "starts_at": _future_iso(2),
        "duration_minutes": 30,
        "link": "https://meet.example.com/abc",
        "notes": "Bring updates",
        "location": "Room A",
    }
    res = client.post("/api/meetings", headers=h, json=payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["title"] == "Standup"
    assert data["duration_minutes"] == 30
    assert count_meetings(uid) == 1


def test_create_meeting_validates_required_fields(client, register_user):
    _, token = register_user("mtg_req")
    h = {"Authorization": f"Bearer {token}"}

    res = client.post("/api/meetings", headers=h, json={
        "starts_at": _future_iso(),
        "duration_minutes": 30,
    })
    assert res.status_code == 400

    res2 = client.post("/api/meetings", headers=h, json={
        "title": "   ",
        "starts_at": _future_iso(),
    })
    assert res2.status_code == 400


def test_create_meeting_normalizes_link_scheme(client, register_user):
    _, token = register_user("mtg_link")
    h = {"Authorization": f"Bearer {token}"}

    res = client.post("/api/meetings", headers=h, json={
        "title": "Zoom call",
        "starts_at": _future_iso(),
        "link": "zoom.us/j/123",
    })
    assert res.status_code == 201, res.text
    assert res.json()["link"] == "https://zoom.us/j/123"


def test_create_meeting_rejects_invalid_duration(client, register_user):
    _, token = register_user("mtg_dur")
    h = {"Authorization": f"Bearer {token}"}
    base = {"title": "X", "starts_at": _future_iso()}

    assert client.post("/api/meetings", headers=h, json={**base, "duration_minutes": 0}).status_code == 400
    assert client.post("/api/meetings", headers=h, json={**base, "duration_minutes": 2000}).status_code == 400


def test_list_meetings_returns_user_data_only(client, register_user):
    _, token_a = register_user("mtg_a")
    _, token_b = register_user("mtg_b")
    uid_a = _user_id_from(token_a)
    h_a = {"Authorization": f"Bearer {token_a}"}
    h_b = {"Authorization": f"Bearer {token_b}"}

    insert_meeting(uid_a, title="Mine", starts_at=_future_iso(1), duration_minutes=30)

    res_a = client.get("/api/meetings", headers=h_a)
    assert res_a.status_code == 200
    assert len(res_a.json()["meetings"]) == 1

    res_b = client.get("/api/meetings", headers=h_b)
    assert res_b.status_code == 200
    assert len(res_b.json()["meetings"]) == 0


def test_list_meetings_filters_by_range(client, register_user):
    _, token = register_user("mtg_range")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    soon = _future_iso(2)
    later = _future_iso(48)
    far = _future_iso(120)
    insert_meeting(uid, title="Soon", starts_at=soon, duration_minutes=30)
    insert_meeting(uid, title="Later", starts_at=later, duration_minutes=30)
    insert_meeting(uid, title="Far", starts_at=far, duration_minutes=30)

    from_iso = quote((datetime.now(timezone.utc) + timedelta(hours=1)).isoformat())
    to_iso = quote((datetime.now(timezone.utc) + timedelta(hours=72)).isoformat())
    res = client.get(f"/api/meetings?from={from_iso}&to={to_iso}", headers=h)
    assert res.status_code == 200
    titles = {m["title"] for m in res.json()["meetings"]}
    assert titles == {"Soon", "Later"}
    assert "Far" not in titles


def test_update_meeting_partial(client, register_user):
    _, token = register_user("mtg_patch")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    row = insert_meeting(
        uid, title="Original", starts_at=_future_iso(3),
        duration_minutes=45, link="https://a.com", notes="n", location="loc",
    )
    res = client.patch(f"/api/meetings/{row['id']}", headers=h, json={"title": "Updated"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["title"] == "Updated"
    assert data["duration_minutes"] == 45
    assert data["link"] == "https://a.com"
    assert data["notes"] == "n"
    assert data["location"] == "loc"


def test_update_meeting_rejects_other_user(client, register_user):
    _, token_a = register_user("mtg_pa")
    _, token_b = register_user("mtg_pb")
    uid_a = _user_id_from(token_a)
    row = insert_meeting(uid_a, title="Private", starts_at=_future_iso(), duration_minutes=30)

    res = client.patch(
        f"/api/meetings/{row['id']}",
        headers={"Authorization": f"Bearer {token_b}"},
        json={"title": "Hacked"},
    )
    assert res.status_code == 404


def test_delete_meeting_succeeds(client, register_user):
    _, token = register_user("mtg_del")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    row = insert_meeting(uid, title="Gone", starts_at=_future_iso(), duration_minutes=30)

    res = client.delete(f"/api/meetings/{row['id']}", headers=h)
    assert res.status_code == 204
    assert count_meetings(uid) == 0


def test_account_delete_wipes_meetings(client, register_user, monkeypatch):
    _, token = register_user("mtg_acct")
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}
    insert_meeting(uid, title="Wipe me", starts_at=_future_iso(), duration_minutes=30)
    assert count_meetings(uid) == 1

    import routers.account as account_router
    monkeypatch.setattr(account_router, "chroma_delete_user", lambda u: None)

    assert client.delete("/api/account", headers=h).status_code == 204
    assert count_meetings(uid) == 0


def _post_meeting(client, token: str, **extra):
    h = {"Authorization": f"Bearer {token}"}
    payload = {"title": "T", "starts_at": _future_iso(), **extra}
    return client.post("/api/meetings", headers=h, json=payload)


def test_link_rejects_javascript_scheme(client, register_user):
    _, token = register_user("lnk_js")
    res = _post_meeting(client, token, link="javascript:alert(1)")
    assert res.status_code == 400
    assert "http" in res.json()["detail"].lower()


def test_link_rejects_ftp_scheme(client, register_user):
    _, token = register_user("lnk_ftp")
    res = _post_meeting(client, token, link="ftp://files.example.com")
    assert res.status_code == 400


def test_link_rejects_data_url(client, register_user):
    _, token = register_user("lnk_data")
    res = _post_meeting(client, token, link="data:text/html,<h1>")
    assert res.status_code == 400


def test_link_rejects_mailto(client, register_user):
    _, token = register_user("lnk_mail")
    res = _post_meeting(client, token, link="mailto:test@example.com")
    assert res.status_code == 400


def test_link_accepts_https(client, register_user):
    _, token = register_user("lnk_https")
    res = _post_meeting(client, token, link="https://zoom.us/j/123")
    assert res.status_code == 201
    assert res.json()["link"] == "https://zoom.us/j/123"


def test_link_accepts_http(client, register_user):
    _, token = register_user("lnk_http")
    res = _post_meeting(client, token, link="http://meet.example.com")
    assert res.status_code == 201
    assert res.json()["link"] == "http://meet.example.com"


def test_link_normalizes_bare_hostname(client, register_user):
    _, token = register_user("lnk_host")
    res = _post_meeting(client, token, link="zoom.us/j/123")
    assert res.status_code == 201
    assert res.json()["link"] == "https://zoom.us/j/123"


def test_link_rejects_garbage(client, register_user):
    _, token = register_user("lnk_garbage")
    res = _post_meeting(client, token, link="not a url at all")
    assert res.status_code == 400


def test_link_trims_whitespace(client, register_user):
    _, token = register_user("lnk_trim")
    res = _post_meeting(client, token, link="  zoom.us  ")
    assert res.status_code == 201
    assert res.json()["link"] == "https://zoom.us"
