"""Connectivity of the demo graph on REAL embeddings.

This is the test that would have caught the bug. Its predecessor
(`test_seed_produces_a_connected_graph`) ran under a fixture that swapped in
orthogonal per-file vectors and asserted only that >=25% of nodes had a link, so
a graph of 35 components with 24 isolated notes sailed through it.

Here the seeder runs against the actual MiniLM model over the actual corpus, and
the assertions are about component structure: one dominant component covering
the large majority of notes, and almost nothing floating free.

Skipped when sentence-transformers is not installed. CI installs
backend/requirements-test.txt, which deliberately excludes torch, so this does
NOT run there — the CI-side guards are the structural test and the
DEMO_EDGE_THRESHOLD tripwire in test_seed_demo.py. It does run for anyone with a
working local stack, which is anyone who can run the demo at all.
"""

import pytest

from database.db import get_all_chunks
from tests.test_graph_edges import _user_id_from
from tests.test_seed_demo import graph_components

pytest.importorskip(
    "sentence_transformers",
    reason="real-embedding connectivity check needs the full ML stack",
)

# Measured over the 87-note corpus at DEMO_EDGE_THRESHOLD=0.22 (see the table in
# routers/seed.py): 3 components, largest 85 (97.7%), 2 isolated. The bounds sit
# a little looser than the measurement so a model-version bump that nudges a few
# similarities does not fail the build, while the 33%-largest / 24-isolated
# shape of the original bug fails it loudly.
MIN_LARGEST_COMPONENT_SHARE = 0.90
MAX_ISOLATED_NOTES = 4


def test_demo_graph_is_one_connected_constellation(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)

    body = client.post("/api/seed", headers={"Authorization": f"Bearer {token}"}).json()
    assert body["edges_total"] > 0

    graph = client.get(
        "/api/graph?limit=2000", headers={"Authorization": f"Bearer {token}"}
    ).json()
    nodes = graph["nodes"]
    assert len(nodes) == len(get_all_chunks(uid))

    components = graph_components(graph)
    largest = len(components[0])
    isolated = [n for n in nodes if n["degree"] == 0]

    assert largest >= MIN_LARGEST_COMPONENT_SHARE * len(nodes), (
        f"largest component is {largest}/{len(nodes)} "
        f"({100 * largest / len(nodes):.1f}%) across {len(components)} components; "
        f"the demo graph has fragmented"
    )
    assert len(isolated) <= MAX_ISOLATED_NOTES, (
        f"{len(isolated)} notes have no link at all: "
        f"{[n['label'][:48] for n in isolated]}"
    )


def test_demo_graph_is_not_a_hairball(client, register_user):
    """Connectivity must not have been bought by linking everything to everything.

    MAX_EDGES_PER_CHUNK caps how many neighbours a note proposes, so the edge
    count has a hard ceiling of nodes * K / 2. Staying well under it is what
    keeps the constellation readable.
    """
    _, token = register_user()
    client.post("/api/seed", headers={"Authorization": f"Bearer {token}"})
    graph = client.get(
        "/api/graph?limit=2000", headers={"Authorization": f"Bearer {token}"}
    ).json()

    nodes, edges = graph["nodes"], graph["edges"]
    average_degree = 2 * len(edges) / len(nodes)
    assert average_degree <= 10.0, (
        f"average degree {average_degree:.1f} — the graph is a hairball"
    )
    assert all(e["weight"] >= 0.22 for e in edges), "an edge landed below the threshold"


def test_demo_graph_edges_stay_within_the_calling_user(client, register_user):
    """Lowering the threshold widens the neighbour net; it must not cross users."""
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_b = _user_id_from(token_b)

    client.post("/api/seed", headers={"Authorization": f"Bearer {token_a}"})
    client.post("/api/seed", headers={"Authorization": f"Bearer {token_b}"})

    graph_b = client.get(
        "/api/graph?limit=2000", headers={"Authorization": f"Bearer {token_b}"}
    ).json()
    own = {row["id"] for row in get_all_chunks(uid_b)}
    assert {n["id"] for n in graph_b["nodes"]} == own
    for edge in graph_b["edges"]:
        assert edge["source"] in own and edge["target"] in own
