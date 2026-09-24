"""Demo corpus loader — date-independent spread, re-seedable, scoped.

The seeder used to backdate last_accessed by a fixed number of days, so a corpus
built months ago decayed into all-critical and the loader then refused to
refresh it. These tests pin the two properties that fixes: the spread is
computed from the current clock, and reloading replaces rather than refuses.
"""

import math
from collections import Counter

import pytest

from database.db import (
    DEFAULT_USER_ID,
    count_chunks,
    get_all_chunks,
    get_chunk_ids_by_source_prefix,
    insert_chunk,
)
from intelligence.memory import calculate_retention, classify_retention
from routers import seed as seed_router
from routers._shared import retention_anchor

from tests.test_graph_edges import _user_id_from

BUCKETS = ("strong", "fading", "weak", "critical")
DIM = 384


@pytest.fixture(autouse=True)
def fake_embeddings(monkeypatch):
    """Stub the embedder: CI installs no torch, and real vectors would make the
    edge assertions depend on MiniLM's behaviour.

    Each demo source file gets its own orthogonal dimension pair, so notes from
    the same file are near-identical and notes from different files are exactly
    unrelated. That gives deterministic, file-shaped clusters to link.
    """
    import routers.seed as seed_router

    sources = [source for _, source, _, _ in seed_router._SEED_ITEMS]
    cluster_of = {name: i for i, name in enumerate(dict.fromkeys(sources))}
    source_by_text = {text: source for text, source, _, _ in seed_router._SEED_ITEMS}
    seen: Counter = Counter()

    def embed(texts):
        out = []
        for text in texts:
            source = source_by_text[text]
            base = cluster_of[source] * 2
            # Spread members of a cluster along a small arc so edge weights vary
            # but stay far above the demo threshold.
            angle = seen[source] * 0.05
            seen[source] += 1
            v = [0.0] * DIM
            v[base] = math.cos(angle)
            v[base + 1] = math.sin(angle)
            out.append(v)
        return out

    monkeypatch.setattr(seed_router, "embed_texts", embed)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def seed(client, token):
    return client.post("/api/seed", headers=auth(token))


def graph_components(graph: dict) -> list[set[str]]:
    """Connected components of a GET /api/graph response, largest first."""
    adjacency: dict[str, set[str]] = {node["id"]: set() for node in graph["nodes"]}
    for edge in graph["edges"]:
        adjacency[edge["source"]].add(edge["target"])
        adjacency[edge["target"]].add(edge["source"])

    seen: set[str] = set()
    components: list[set[str]] = []
    for start in adjacency:
        if start in seen:
            continue
        stack, component = [start], set()
        while stack:
            node = stack.pop()
            if node in component:
                continue
            component.add(node)
            stack.extend(n for n in adjacency[node] if n not in component)
        seen |= component
        components.append(component)
    return sorted(components, key=len, reverse=True)


def live_buckets(user_id: str) -> Counter:
    """Classify the user's demo chunks the way every read path does."""
    counts: Counter = Counter()
    for row in get_all_chunks(user_id):
        if not (row["source_file"] or "").startswith("demo/"):
            continue
        r = calculate_retention(
            retention_anchor(row), row["access_count"], row["complexity_score"]
        )
        counts[classify_retention(r)] += 1
    return counts


# -- Spread -------------------------------------------------------------------

def test_seed_lands_every_bucket_from_the_current_clock(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)

    res = seed(client, token)
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["seeded"] > 50
    counts = live_buckets(uid)
    # Every bucket populated — the old seeder collapsed to critical over time.
    for bucket in BUCKETS:
        assert counts[bucket] > 0, f"no chunks in {bucket}: {dict(counts)}"

    total = sum(counts.values())
    assert counts["strong"] / total > 0.2
    assert counts["critical"] / total < 0.3


def test_reported_buckets_match_what_the_read_paths_compute(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)

    reported = Counter(seed(client, token).json()["buckets"])

    assert reported == live_buckets(uid)


def test_retention_anchor_is_the_tuning_knob_not_last_accessed(client, register_user):
    """last_accessed stays an honest 'last viewed'; the anchor places the bucket."""
    _, token = register_user()
    uid = _user_id_from(token)
    seed(client, token)

    differing = 0
    for row in get_all_chunks(uid):
        assert row["retention_anchor"] is not None
        if row["retention_anchor"] != row["last_accessed"]:
            differing += 1
    assert differing > 0, "the anchor should be solved for, not copied from last_accessed"


def test_graph_api_shows_every_bucket_after_seeding(client, register_user):
    _, token = register_user()
    seed(client, token)

    body = client.get("/api/graph?limit=300", headers=auth(token)).json()
    seen = {n["bucket"] for n in body["nodes"]}

    assert seen == set(BUCKETS)


# -- Re-seedable --------------------------------------------------------------

def test_reseeding_replaces_rather_than_refusing(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)

    first = seed(client, token).json()
    assert first["removed"] == 0
    after_first = count_chunks(uid)

    second = seed(client, token).json()

    assert second["seeded"] == first["seeded"], "a reload must rebuild the corpus"
    assert second["removed"] == first["seeded"], "and clear the previous one first"
    assert count_chunks(uid) == after_first, "no duplicate accumulation"


def test_reseeding_refreshes_a_decayed_corpus(client, register_user):
    """The case the old loader could not handle: stale demo data already present."""
    _, token = register_user()
    uid = _user_id_from(token)
    seed(client, token)

    # Force the whole corpus to look ancient, as months of real decay would.
    from database.db import set_retention_anchors
    stale = {cid: "2025-01-01T00:00:00+00:00" for cid in get_chunk_ids_by_source_prefix(uid, "demo/")}
    set_retention_anchors(uid, stale)
    assert set(live_buckets(uid)) == {"critical"}

    seed(client, token)

    counts = live_buckets(uid)
    for bucket in BUCKETS:
        assert counts[bucket] > 0, f"reload failed to restore {bucket}: {dict(counts)}"


def test_reseeding_never_touches_non_demo_notes(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    mine = insert_chunk(
        content="a note I wrote myself",
        source_file="my_notes.md",
        complexity_score=0.5,
        user_id=uid,
    )

    seed(client, token)
    seed(client, token)

    kept = [r for r in get_all_chunks(uid) if r["id"] == mine]
    assert len(kept) == 1
    assert kept[0]["content"] == "a note I wrote myself"


# -- Connectivity -------------------------------------------------------------
#
# The graph this module can check is the one the `fake_embeddings` fixture above
# produces: orthogonal per-file clusters. That is a fair test of the edge
# *builder* (does it link everything it should, and nothing it should not) but it
# says nothing about DEMO_EDGE_THRESHOLD, because the synthetic within-cluster
# similarity is ~1.0 and clears any plausible threshold.
#
# Connectivity of the real demo graph — the thing that actually broke — is
# checked against real MiniLM vectors in test_seed_graph_real_embeddings.py.
# This file keeps the structural half plus a tripwire on the tuned constant.


def test_seed_links_every_note_that_has_a_same_file_neighbour(client, register_user):
    """Component structure must match the embedding structure exactly.

    With one orthogonal cluster per source file, the correct graph has exactly
    one component per source file and no cross-file edges. A note is isolated
    only when it is the sole note in its file and therefore has nothing to link
    to. Asserting the whole partition (rather than a fraction of linked nodes)
    is what makes this fail if the edge builder, the neighbour cap or the
    per-user scoping regresses.
    """
    _, token = register_user()
    uid = _user_id_from(token)
    body = seed(client, token).json()
    assert body["edges_total"] > 0

    graph = client.get("/api/graph?limit=2000", headers=auth(token)).json()
    components = graph_components(graph)

    source_of = {row["id"]: row["source_file"] for row in get_all_chunks(uid)}
    expected: dict[str, set[str]] = {}
    for cid, source in source_of.items():
        expected.setdefault(source, set()).add(cid)

    assert sorted(len(c) for c in components) == sorted(len(c) for c in expected.values())
    assert {frozenset(c) for c in components} == {frozenset(c) for c in expected.values()}, (
        "components do not line up one-to-one with source files"
    )

    isolated = {n["id"] for n in graph["nodes"] if n["degree"] == 0}
    alone = {cid for source, ids in expected.items() if len(ids) == 1 for cid in ids}
    assert isolated == alone, (
        f"{len(isolated)} isolated notes but {len(alone)} single-note files"
    )


def test_demo_edge_threshold_is_the_value_its_connectivity_was_measured_at():
    """Tripwire on a tuned constant.

    DEMO_EDGE_THRESHOLD was chosen by measuring component structure over the real
    corpus at a range of values (the table in seed.py). Nothing in a torch-free
    CI run can re-derive that, so changing the constant must be a deliberate act
    that comes with a fresh measurement — this test is what forces it.
    """
    assert seed_router.DEMO_EDGE_THRESHOLD == 0.22, (
        "DEMO_EDGE_THRESHOLD changed. Re-measure connectivity over the real "
        "corpus, update the table in seed.py, then update this test."
    )


# -- Per-user isolation -------------------------------------------------------

def test_seeding_is_scoped_to_the_caller(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a, uid_b = _user_id_from(token_a), _user_id_from(token_b)

    seed(client, token_a)
    seed(client, token_b)
    before_a = count_chunks(uid_a)

    # B reloading must not remove or duplicate anything of A's.
    seed(client, token_b)

    assert count_chunks(uid_a) == before_a
    assert len(get_chunk_ids_by_source_prefix(uid_a, "demo/")) == before_a


def test_seed_requires_auth(client):
    assert client.post("/api/seed").status_code == 401


# -- Startup auto-seed ----------------------------------------------------------

def demo_ids() -> list[str]:
    return get_chunk_ids_by_source_prefix(DEFAULT_USER_ID, seed_router.DEMO_SOURCE_PREFIX)


def test_autoseed_populates_an_empty_demo_account(client):
    assert demo_ids() == []

    seed_router.autoseed_demo_if_empty()

    assert len(demo_ids()) == len(seed_router._SEED_ITEMS)
    for bucket in BUCKETS:
        assert live_buckets(DEFAULT_USER_ID)[bucket] > 0


def test_autoseed_skips_when_demo_corpus_already_present(client):
    seed_router.autoseed_demo_if_empty()
    before = sorted(demo_ids())

    seed_router.autoseed_demo_if_empty()

    # Same rows, not a rebuilt corpus with fresh ids.
    assert sorted(demo_ids()) == before


def test_autoseed_never_touches_real_users(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    insert_chunk(content="my own note", source_file="notes.md",
                 complexity_score=0.5, user_id=uid)

    seed_router.autoseed_demo_if_empty()

    assert count_chunks(uid) == 1


def test_autoseed_swallows_seed_failures(client, monkeypatch):
    def boom(**_kwargs):
        raise RuntimeError("vector store down")

    monkeypatch.setattr(seed_router, "seed_demo_data", boom)

    seed_router.autoseed_demo_if_empty()  # must not raise

    assert demo_ids() == []


@pytest.mark.parametrize("flag, expected", [(None, False), ("0", False), ("1", True)])
def test_lifespan_starts_autoseed_only_when_opted_in(tmp_path, monkeypatch, flag, expected):
    import threading

    from fastapi.testclient import TestClient

    import main

    called = threading.Event()
    monkeypatch.setattr(main, "autoseed_demo_if_empty", called.set)
    monkeypatch.setenv("DORY_DB_PATH", str(tmp_path / "boot.db"))
    if flag is None:
        monkeypatch.delenv("DORY_AUTOSEED_DEMO", raising=False)
    else:
        monkeypatch.setenv("DORY_AUTOSEED_DEMO", flag)

    with TestClient(main.app):
        assert called.wait(timeout=5 if expected else 0.2) is expected
