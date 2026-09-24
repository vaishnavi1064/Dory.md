"""The shared demo account on a public deployment.

Demo login is dev-only unless DORY_ALLOW_DEMO_LOGIN=1 opts a deployment in, and
because every visitor shares the account, none of them may delete it.
"""

import pytest

DEMO = {"email": "demo@dory.md", "password": "demo123"}


def demo_login(client):
    return client.post("/api/auth/login", json=DEMO)


def test_demo_login_works_in_dev(client):
    assert demo_login(client).status_code == 200


def test_demo_login_refused_in_production_by_default(client, monkeypatch):
    monkeypatch.setenv("DORY_ENV", "production")
    monkeypatch.delenv("DORY_ALLOW_DEMO_LOGIN", raising=False)

    res = demo_login(client)

    assert res.status_code == 401
    assert "disabled" in res.json()["detail"]


@pytest.mark.parametrize("flag", ["0", "true", ""])
def test_only_the_exact_opt_in_value_enables_it(client, monkeypatch, flag):
    monkeypatch.setenv("DORY_ENV", "production")
    monkeypatch.setenv("DORY_ALLOW_DEMO_LOGIN", flag)

    assert demo_login(client).status_code == 401


def test_demo_login_allowed_in_production_when_opted_in(client, monkeypatch):
    monkeypatch.setenv("DORY_ENV", "production")
    monkeypatch.setenv("DORY_ALLOW_DEMO_LOGIN", "1")

    res = demo_login(client)

    assert res.status_code == 200, res.text
    assert res.json()["access_token"]


def test_opt_in_does_not_weaken_the_demo_password_check(client, monkeypatch):
    monkeypatch.setenv("DORY_ENV", "production")
    monkeypatch.setenv("DORY_ALLOW_DEMO_LOGIN", "1")

    res = client.post("/api/auth/login", json={**DEMO, "password": "wrong"})

    assert res.status_code == 401


def test_demo_account_cannot_be_deleted(client):
    token = demo_login(client).json()["access_token"]

    res = client.delete("/api/account", headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 403
    # Still there for the next visitor.
    assert demo_login(client).status_code == 200


def test_real_accounts_can_still_be_deleted(client, register_user):
    _, token = register_user()

    res = client.delete("/api/account", headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 204
