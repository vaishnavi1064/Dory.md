"""Phase 1 - semantic edge generation for the knowledge graph.

Chunks are inserted directly with hand-built unit vectors so cosine similarity
is exact and the threshold/cap behaviour is deterministic. Chroma is real here
(conftest points it at a throwaway directory), which means these tests also
exercise the per-user `where` filter that keeps one user's graph out of
another's.
"""

import math

from core import graph_edges
from database.db import (
    count_edges,
    delete_edge,
    delete_user_data,
    get_chunk_neighbors,
    get_edges_for_user,
    insert_chunk,
    upsert_edge,
)
from intelligence.retrieval import add_chunks

DIM = 384


def _user_id_from(token: str) -> str:
    from jose import jwt
    from routers.deps import _get_secret, JWT_ALGORITHM
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])["sub"]


def unit_vec(theta: float) -> list[float]:
    """A 384-d unit vector in the first two dimensions. Cosine similarity
    between unit_vec(a) and unit_vec(b) is exactly cos(a - b)."""
    v = [0.0] * DIM
    v[0] = math.cos(theta)
    v[1] = math.sin(theta)
    return v


def make_chunk(user_id: str, theta: float, content: str = "a note", source: str = "t.md") -> str:
    """Insert a chunk into both stores with a chosen embedding direction."""
    cid = insert_chunk(
        content=content, source_file=source, complexity_score=0.5, user_id=user_id
    )
    add_chunks(
        [cid],
        [unit_vec(theta)],
        [{"user_id": user_id, "chunk_id": cid, "source_file": source}],
    )
    return cid


# -- Threshold and density ---------------------------------------------------

def test_edge_created_above_threshold(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a = make_chunk(uid, 0.0)
    b = make_chunk(uid, 0.2)  # cos(0.2) ~ 0.980, well above tau = 0.6

    written = graph_edges.generate_edges_for_chunk(uid, a)

    assert written == 1
    assert count_edges(uid) == 1
    edge = get_edges_for_user(uid)[0]
    assert {edge["source_id"], edge["target_id"]} == {a, b}
    assert edge["edge_type"] == "semantic"
    assert edge["weight"] > 0.9


def test_no_edge_below_threshold(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a = make_chunk(uid, 0.0)
    make_chunk(uid, math.pi / 2)  # cos(pi/2) = 0.0, far below tau

    assert graph_edges.generate_edges_for_chunk(uid, a) == 0
    assert count_edges(uid) == 0


def test_density_capped_at_k(client, register_user, monkeypatch):
    monkeypatch.setenv("MAX_EDGES_PER_CHUNK", "2")
    _, token = register_user()
    uid = _user_id_from(token)

    a = make_chunk(uid, 0.0)
    for i in range(1, 7):  # six candidates, all comfortably above tau
        make_chunk(uid, 0.02 * i)

    written = graph_edges.generate_edges_for_chunk(uid, a)

    assert written == 2
    assert len(get_chunk_neighbors(a, uid)) == 2


def test_threshold_and_cap_read_from_env(monkeypatch):
    monkeypatch.setenv("SEMANTIC_EDGE_THRESHOLD", "0.9")
    monkeypatch.setenv("MAX_EDGES_PER_CHUNK", "3")
    monkeypatch.setenv("SPREAD_ALPHA", "0.75")
    assert graph_edges.semantic_edge_threshold() == 0.9
    assert graph_edges.max_edges_per_chunk() == 3
    assert graph_edges.spread_alpha() == 0.75

    # Garbage and out-of-range values fall back or clamp rather than crash.
    monkeypatch.setenv("SEMANTIC_EDGE_THRESHOLD", "not-a-number")
    monkeypatch.setenv("SPREAD_ALPHA", "9")
    assert graph_edges.semantic_edge_threshold() == graph_edges.DEFAULT_EDGE_THRESHOLD
    assert graph_edges.spread_alpha() == 1.0


# -- Rebuild -----------------------------------------------------------------

def test_rebuild_is_idempotent(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    for i in range(3):
        make_chunk(uid, 0.03 * i)

    first = graph_edges.rebuild_edges_for_user(uid)
    assert first["edges_total"] > 0
    assert first["edges_created"] == first["edges_total"]

    second = graph_edges.rebuild_edges_for_user(uid)
    assert second["edges_created"] == 0
    assert second["edges_total"] == first["edges_total"]
    assert count_edges(uid) == first["edges_total"]


def test_rebuild_on_empty_account_is_noop(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    assert graph_edges.rebuild_edges_for_user(uid) == {"edges_created": 0, "edges_total": 0}


# -- Per-user isolation ------------------------------------------------------

def test_generation_never_links_another_users_chunk(client, register_user):
    """Identical vectors across two accounts must still produce no edge."""
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)

    a1 = make_chunk(uid_a, 0.0)
    a2 = make_chunk(uid_a, math.pi / 2)  # A's own chunk, deliberately dissimilar
    make_chunk(uid_b, 0.0)  # B's chunk: an exact vector match for a1
    make_chunk(uid_b, 0.01)

    graph_edges.generate_edges_for_chunk(uid_a, a1)
    graph_edges.rebuild_edges_for_user(uid_a)

    assert count_edges(uid_a) == 0
    assert count_edges(uid_b) == 0
    assert get_chunk_neighbors(a1, uid_a) == []
    assert get_chunk_neighbors(a2, uid_a) == []


def test_upsert_edge_rejects_cross_user_pair(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)
    a = make_chunk(uid_a, 0.0)
    b = make_chunk(uid_b, 0.0)

    # Neither user may forge an edge spanning the boundary, in either direction.
    assert upsert_edge(uid_a, a, b, weight=0.99) is False
    assert upsert_edge(uid_b, a, b, weight=0.99) is False
    assert upsert_edge(uid_a, b, a, weight=0.99) is False
    assert count_edges(uid_a) == 0
    assert count_edges(uid_b) == 0


def test_delete_edge_is_scoped_to_owner(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)
    a1, a2 = make_chunk(uid_a, 0.0), make_chunk(uid_a, 0.1)
    assert upsert_edge(uid_a, a1, a2, weight=0.9) is True
    edge_id = get_edges_for_user(uid_a)[0]["id"]

    assert delete_edge(edge_id, uid_b) is False  # not B's edge
    assert count_edges(uid_a) == 1
    assert delete_edge(edge_id, uid_a) is True
    assert count_edges(uid_a) == 0


def test_account_deletion_removes_edges(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a1, a2 = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a1, a2, weight=0.9)
    assert count_edges(uid) == 1

    assert delete_user_data(uid) is True
    assert count_edges(uid) == 0


# -- Edge invariants ---------------------------------------------------------

def test_self_edge_is_rejected(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a = make_chunk(uid, 0.0)
    assert upsert_edge(uid, a, a, weight=1.0) is False
    assert count_edges(uid) == 0


def test_canonical_ordering_and_upsert(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    low, high = sorted([a, b])

    # Insert with the arguments reversed; storage order must still be canonical.
    assert upsert_edge(uid, high, low, weight=0.70) is True
    edge = get_edges_for_user(uid)[0]
    assert edge["source_id"] == low and edge["target_id"] == high

    # The same pair in the other order updates that row rather than adding one.
    assert upsert_edge(uid, low, high, weight=0.85) is True
    assert count_edges(uid) == 1
    assert get_edges_for_user(uid)[0]["weight"] == 0.85


def test_neighbors_traverse_both_columns(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    a, b = make_chunk(uid, 0.0), make_chunk(uid, 0.1)
    upsert_edge(uid, a, b, weight=0.9)

    a_neighbors = get_chunk_neighbors(a, uid)
    b_neighbors = get_chunk_neighbors(b, uid)

    assert [r["neighbor_id"] for r in a_neighbors] == [b]
    assert [r["neighbor_id"] for r in b_neighbors] == [a]
    # The row carries what spreading activation and the graph API need.
    assert "fsrs_stability" in a_neighbors[0].keys()
    assert a_neighbors[0]["weight"] == 0.9


# -- Ingest wiring -----------------------------------------------------------

def test_ingest_generates_edges(client, register_user, monkeypatch):
    """Edges appear through the real POST /api/ingest/text path."""
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    import routers.ingest as ingest_router

    seen = {"n": 0}

    def fake_embed(chunks):
        out = []
        for _ in chunks:
            out.append(unit_vec(0.05 * seen["n"]))
            seen["n"] += 1
        return out

    monkeypatch.setattr(ingest_router, "embed_texts", fake_embed)
    monkeypatch.setattr(ingest_router, "classify_and_store", lambda *a, **k: None)

    for i in range(2):
        res = client.post(
            "/api/ingest/text",
            headers=h,
            json={"content": f"Note number {i} with enough words in it to form a chunk."},
        )
        assert res.status_code == 200, res.text

    assert count_edges(uid) == 1


def test_ingest_survives_edge_generation_failure(client, register_user, monkeypatch):
    """Edge generation is enrichment: a failure must not fail the ingest."""
    _, token = register_user()
    uid = _user_id_from(token)
    h = {"Authorization": f"Bearer {token}"}

    import routers.ingest as ingest_router

    monkeypatch.setattr(ingest_router, "embed_texts", lambda chunks: [unit_vec(0.0) for _ in chunks])
    monkeypatch.setattr(ingest_router, "classify_and_store", lambda *a, **k: None)

    def boom(*args, **kwargs):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(graph_edges, "generate_edges_for_chunk", boom)

    res = client.post(
        "/api/ingest/text",
        headers=h,
        json={"content": "A note that should still be ingested despite a graph failure."},
    )

    assert res.status_code == 200, res.text
    assert count_edges(uid) == 0
