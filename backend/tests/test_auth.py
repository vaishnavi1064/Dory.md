"""Auth flow: register, login, refresh rotation, logout."""


def test_register_returns_access_and_refresh(register_user):
    data, _access = register_user()
    assert "access_token" in data and data["access_token"]
    assert "refresh_token" in data and data["refresh_token"]
    assert data["token_type"] == "Bearer"
    assert data["expires_in"] > 0
    # Refresh token is opaque, not the access token
    assert data["access_token"] != data["refresh_token"]


def test_login_with_correct_password(client, register_user):
    user, _ = register_user()
    res = client.post("/api/auth/login", json={"email": user["email"], "password": "test-password-123"})
    assert res.status_code == 200
    assert res.json()["email"] == user["email"]


def test_login_wrong_password_rejected(client, register_user):
    user, _ = register_user()
    res = client.post("/api/auth/login", json={"email": user["email"], "password": "wrong"})
    assert res.status_code == 401


def test_protected_endpoint_requires_token(client):
    res = client.get("/api/chunks")
    assert res.status_code == 401


def test_protected_endpoint_accepts_access_token(client, register_user):
    _, access = register_user()
    res = client.get("/api/chunks", headers={"Authorization": f"Bearer {access}"})
    assert res.status_code == 200


def test_refresh_rotates_token(client, register_user):
    user, _ = register_user()
    refresh1 = user["refresh_token"]
    res = client.post("/api/auth/refresh", json={"refresh_token": refresh1})
    assert res.status_code == 200
    pair2 = res.json()
    assert pair2["refresh_token"] != refresh1, "refresh token should rotate"

    # The old refresh token must now be revoked.
    res2 = client.post("/api/auth/refresh", json={"refresh_token": refresh1})
    assert res2.status_code == 401

    # The new refresh token works.
    res3 = client.post("/api/auth/refresh", json={"refresh_token": pair2["refresh_token"]})
    assert res3.status_code == 200


def test_logout_revokes_refresh_token(client, register_user):
    user, access = register_user()
    refresh = user["refresh_token"]
    res = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {access}"},
        json={"refresh_token": refresh},
    )
    assert res.status_code == 200

    # After logout, the refresh token is dead.
    res2 = client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert res2.status_code == 401


def test_access_token_with_wrong_type_rejected(client, register_user):
    """Using a refresh token where an access token is expected must 401."""
    user, _ = register_user()
    res = client.get(
        "/api/chunks",
        headers={"Authorization": f"Bearer {user['refresh_token']}"},
    )
    assert res.status_code == 401
