"""Phase 3 - the knowledge-graph read API.

Covers the response shapes, the bucket/focus/limit bounds, and the rule that a
user can only ever see their own nodes and edges.
"""

from database.db import count_edges, upsert_edge

from tests.test_graph_edges import _user_id_from, make_chunk


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# -- Response shape ----------------------------------------------------------

def test_graph_returns_nodes_and_edges(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0, content="Binary search halves the range"), make_chunk(
        uid, 0.1, content="Gradient descent follows the slope"
    )
    upsert_edge(uid, a, b, weight=0.82)

    res = client.get("/api/graph", headers=auth(token))
    assert res.status_code == 200, res.text
    body = res.json()

    assert {n["id"] for n in body["nodes"]} == {a, b}
    node = next(n for n in body["nodes"] if n["id"] == a)
    assert set(node) == {"id", "label", "retention", "bucket", "degree"}
    assert node["label"].startswith("Binary search")
    assert 0.0 <= node["retention"] <= 1.0
    assert node["bucket"] in {"strong", "fading", "weak", "critical"}
    assert node["degree"] == 1

    assert len(body["edges"]) == 1
    edge = body["edges"][0]
    assert set(edge) == {"source", "target", "weight", "type"}
    assert {edge["source"], edge["target"]} == {a, b}
    assert edge["type"] == "semantic"


def test_graph_is_empty_for_a_new_account(client, register_user):
    _, token = register_user()
    res = client.get("/api/graph", headers=auth(token))
    assert res.status_code == 200
    assert res.json() == {"nodes": [], "edges": []}


def test_neighbors_endpoint_shape(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1, content="A neighbouring note")
    upsert_edge(uid, a, b, weight=0.77)

    res = client.get(f"/api/graph/chunk/{a}/neighbors", headers=auth(token))
    assert res.status_code == 200, res.text
    body = res.json()

    assert len(body) == 1
    assert set(body[0]) == {"chunk_id", "label", "weight", "type", "retention", "bucket"}
    assert body[0]["chunk_id"] == b
    assert body[0]["weight"] == 0.77


def test_neighbors_of_unknown_chunk_is_404(client, register_user):
    _, token = register_user()
    res = client.get("/api/graph/chunk/nope/neighbors", headers=auth(token))
    assert res.status_code == 404


# -- Bounds: limit, focus, bucket --------------------------------------------

def test_limit_is_respected(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    for i in range(6):
        make_chunk(uid, 0.05 * i)

    res = client.get("/api/graph?limit=3", headers=auth(token))
    assert res.status_code == 200
    assert len(res.json()["nodes"]) == 3


def test_edges_never_dangle_when_nodes_are_truncated(client, register_user):
    """An edge may only reference nodes present in the same response."""
    _, token = register_user()
    uid = _user_id_from(token)
    ids = [make_chunk(uid, 0.05 * i) for i in range(5)]
    for i in range(len(ids) - 1):
        upsert_edge(uid, ids[i], ids[i + 1], weight=0.9)

    res = client.get("/api/graph?limit=2", headers=auth(token))
    body = res.json()
    returned = {n["id"] for n in body["nodes"]}

    assert len(returned) == 2
    for edge in body["edges"]:
        assert edge["source"] in returned
        assert edge["target"] in returned


def test_focus_returns_only_that_neighborhood(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b, far = make_chunk(uid, 0.0), make_chunk(uid, 0.1), make_chunk(uid, 1.5)
    upsert_edge(uid, a, b, weight=0.9)

    res = client.get(f"/api/graph?focus_chunk_id={a}", headers=auth(token))
    assert res.status_code == 200
    returned = {n["id"] for n in res.json()["nodes"]}

    assert returned == {a, b}
    assert far not in returned


def test_focus_on_unknown_chunk_is_404(client, register_user):
    _, token = register_user()
    res = client.get("/api/graph?focus_chunk_id=nope", headers=auth(token))
    assert res.status_code == 404


def test_bucket_filter(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    make_chunk(uid, 0.0)

    res = client.get("/api/graph?bucket=strong", headers=auth(token))
    assert res.status_code == 200
    assert all(n["bucket"] == "strong" for n in res.json()["nodes"])

    res = client.get("/api/graph?bucket=critical", headers=auth(token))
    assert res.status_code == 200
    assert all(n["bucket"] == "critical" for n in res.json()["nodes"])


def test_invalid_bucket_is_400(client, register_user):
    _, token = register_user()
    res = client.get("/api/graph?bucket=nonsense", headers=auth(token))
    assert res.status_code == 400


# -- Rebuild -----------------------------------------------------------------

def test_rebuild_endpoint_is_idempotent(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    for i in range(3):
        make_chunk(uid, 0.03 * i)

    first = client.post("/api/graph/rebuild", headers=auth(token))
    assert first.status_code == 200, first.text
    assert first.json()["edges_total"] > 0
    assert first.json()["edges_created"] == first.json()["edges_total"]

    second = client.post("/api/graph/rebuild", headers=auth(token))
    assert second.json()["edges_created"] == 0
    assert second.json()["edges_total"] == first.json()["edges_total"]
    assert count_edges(uid) == first.json()["edges_total"]


# -- Per-user isolation ------------------------------------------------------

def test_graph_shows_only_the_callers_nodes_and_edges(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)

    a1, a2 = make_chunk(uid_a, 0.0), make_chunk(uid_a, 0.1)
    b1, b2 = make_chunk(uid_b, 0.0), make_chunk(uid_b, 0.1)
    upsert_edge(uid_a, a1, a2, weight=0.9)
    upsert_edge(uid_b, b1, b2, weight=0.9)

    body = client.get("/api/graph", headers=auth(token_a)).json()
    ids = {n["id"] for n in body["nodes"]}

    assert ids == {a1, a2}
    assert b1 not in ids and b2 not in ids
    assert len(body["edges"]) == 1
    for edge in body["edges"]:
        assert {edge["source"], edge["target"]} == {a1, a2}


def test_cannot_focus_or_inspect_another_users_chunk(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_b = _user_id_from(token_b)
    b1 = make_chunk(uid_b, 0.0)

    assert client.get(f"/api/graph?focus_chunk_id={b1}", headers=auth(token_a)).status_code == 404
    assert client.get(f"/api/graph/chunk/{b1}/neighbors", headers=auth(token_a)).status_code == 404


def test_rebuild_only_touches_the_callers_graph(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)
    for i in range(3):
        make_chunk(uid_a, 0.03 * i)
        make_chunk(uid_b, 0.03 * i)

    client.post("/api/graph/rebuild", headers=auth(token_a))

    assert count_edges(uid_a) > 0
    assert count_edges(uid_b) == 0


def test_graph_endpoints_require_auth(client):
    assert client.get("/api/graph").status_code == 401
    assert client.get("/api/graph/chunk/x/neighbors").status_code == 401
    assert client.post("/api/graph/rebuild").status_code == 401
