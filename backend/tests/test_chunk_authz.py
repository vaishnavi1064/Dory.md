"""Cross-user authorization on chunk endpoints.

Each test exercises one of the bugs from the original review: user A's auth
token must not be able to read/modify/delete user B's chunks.
"""

from database.db import insert_chunk


def _seed_chunk(user_id: str, content: str = "secret note") -> str:
    return insert_chunk(content=content, source_file="seed.md", complexity_score=0.5, user_id=user_id)


def test_user_cannot_read_other_users_chunk(client, register_user):
    _, alice_token = register_user("alice")
    _, bob_token = register_user("bob")
    alice_id = _user_id_from(alice_token)
    bob_id = _user_id_from(bob_token)

    alice_chunk = _seed_chunk(alice_id, "alice's private note")
    bob_chunk = _seed_chunk(bob_id, "bob's private note")

    # Bob cannot read Alice's chunk.
    res = client.get(f"/api/chunks/{alice_chunk}", headers={"Authorization": f"Bearer {bob_token}"})
    assert res.status_code == 404

    # Alice can read her own.
    res = client.get(f"/api/chunks/{alice_chunk}", headers={"Authorization": f"Bearer {alice_token}"})
    assert res.status_code == 200
    assert "alice" in res.json()["content"]

    # And neither sees the other in the list endpoint.
    listed = client.get("/api/chunks", headers={"Authorization": f"Bearer {alice_token}"}).json()["chunks"]
    assert all(c["chunk_id"] != bob_chunk for c in listed)


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import _get_secret, JWT_ALGORITHM
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def test_user_cannot_delete_other_users_chunk(client, register_user):
    _, alice_token = register_user("alice")
    _, bob_token = register_user("bob")
    alice_id = _user_id_from(alice_token)
    bob_id = _user_id_from(bob_token)

    alice_chunk = _seed_chunk(alice_id, "alice keeps this")

    # Bob tries to delete Alice's chunk → 404.
    res = client.delete(f"/api/chunks/{alice_chunk}", headers={"Authorization": f"Bearer {bob_token}"})
    assert res.status_code == 404

    # Alice's chunk is still there.
    res = client.get(f"/api/chunks/{alice_chunk}", headers={"Authorization": f"Bearer {alice_token}"})
    assert res.status_code == 200


def test_user_cannot_update_other_users_chunk(client, register_user):
    _, alice_token = register_user("alice")
    _, bob_token = register_user("bob")
    alice_id = _user_id_from(alice_token)
    _ = _user_id_from(bob_token)

    alice_chunk = _seed_chunk(alice_id, "alice original")

    res = client.put(
        f"/api/chunks/{alice_chunk}",
        headers={"Authorization": f"Bearer {bob_token}"},
        json={"content": "bob's overwrite"},
    )
    assert res.status_code == 404

    # Content is untouched.
    res = client.get(f"/api/chunks/{alice_chunk}", headers={"Authorization": f"Bearer {alice_token}"})
    assert res.json()["content"] == "alice original"


def test_user_cannot_move_other_users_chunk_to_folder(client, register_user):
    _, alice_token = register_user("alice")
    _, bob_token = register_user("bob")
    alice_id = _user_id_from(alice_token)

    alice_chunk = _seed_chunk(alice_id, "alice org")
    res = client.patch(
        f"/api/chunks/{alice_chunk}/folder",
        headers={"Authorization": f"Bearer {bob_token}"},
        json={"folder": "bob-stole-it"},
    )
    assert res.status_code == 404


def test_user_cannot_review_other_users_chunk(client, register_user):
    _, alice_token = register_user("alice")
    _, bob_token = register_user("bob")
    alice_id = _user_id_from(alice_token)

    alice_chunk = _seed_chunk(alice_id, "alice's content")
    res = client.post(f"/api/review/{alice_chunk}", headers={"Authorization": f"Bearer {bob_token}"})
    assert res.status_code == 404


def test_bulk_delete_only_removes_own_chunks(client, register_user):
    _, alice_token = register_user("alice")
    _, bob_token = register_user("bob")
    alice_id = _user_id_from(alice_token)
    bob_id = _user_id_from(bob_token)

    alice_chunk = _seed_chunk(alice_id, "alice keep")
    bob_chunk = _seed_chunk(bob_id, "bob keep")

    res = client.post(
        "/api/chunks/bulk-delete",
        headers={"Authorization": f"Bearer {bob_token}"},
        json={"chunk_ids": [alice_chunk, bob_chunk]},
    )
    assert res.status_code == 200
    # Only Bob's own chunk should be deleted.
    assert res.json()["deleted"] == 1

    # Alice's chunk is still readable.
    res = client.get(f"/api/chunks/{alice_chunk}", headers={"Authorization": f"Bearer {alice_token}"})
    assert res.status_code == 200
