"""The read endpoints the SPA actually calls, which had no tests at all.

  GET /api/search?q=   frontend/src/lib/api.ts:86   <- the real search path
  GET /api/stats       api.ts:137                   dashboard bucket counts
  GET /api/health      HealthPanel                  per-category breakdown
  GET /api/discovery   api.ts:70                    background "at risk" card
  GET /api/folders     api.ts:224                   library folder list

Only POST /api/search was covered, and nothing in the SPA calls it — so the
query-parameter endpoint every search box hits was entirely unguarded.

Every case asserts behaviour AND that one user cannot see another's data: these
are all read paths over get_all_chunks(user_id), so a dropped filter here leaks
the whole corpus.
"""

import pytest

from database.db import get_all_chunks, insert_chunk, set_chunk_folder

from tests.test_graph_edges import _user_id_from

DIM = 384

# Each topic gets its own basis vector, so cosine similarity is 1.0 for the
# matching note and 0.0 for everything else — ranking becomes deterministic
# without the ML stack.
TOPICS = {
    "raft": 0,
    "bolognese": 1,
    "photosynthesis": 2,
}


def vec(slot: int) -> list[float]:
    v = [0.0] * DIM
    v[slot] = 1.0
    return v


def topic_of(text: str) -> int:
    lowered = text.lower()
    for name, slot in TOPICS.items():
        if name in lowered:
            return slot
    return DIM - 1


@pytest.fixture(autouse=True)
def stub_embeddings(monkeypatch):
    """Deterministic topic vectors for both the ingest and the query side."""
    import routers.ingest as ingest_router
    import routers.search as search_router

    monkeypatch.setattr(
        ingest_router, "embed_texts", lambda chunks: [vec(topic_of(c)) for c in chunks]
    )
    monkeypatch.setattr(search_router, "embed_query", lambda q: vec(topic_of(q)))


def auth(token):
    return {"Authorization": f"Bearer {token}"}


NOTES = [
    "Raft is a consensus algorithm that elects a leader and replicates a log.",
    "Bolognese needs a soffritto cooked low and slow before the mince goes in.",
    "Photosynthesis converts light energy into chemical energy inside chloroplasts.",
]


def ingest(client, token, text, source="notes.md"):
    res = client.post(
        "/api/ingest/text", json={"content": text, "source_name": source}, headers=auth(token)
    )
    assert res.status_code == 200, res.text
    return res.json()["chunk_id"]


def seed_notes(client, token):
    return [ingest(client, token, text) for text in NOTES]


# -- GET /api/search?q= --------------------------------------------------------

def test_search_returns_the_matching_note_first(client, register_user):
    _, token = register_user()
    seed_notes(client, token)

    res = client.get("/api/search", params={"q": "raft consensus"}, headers=auth(token))
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["query"] == "raft consensus"
    assert body["total"] == len(body["results"]) > 0
    assert "Raft" in body["results"][0]["chunk"]["content"]


def test_search_results_are_ordered_by_descending_score(client, register_user):
    _, token = register_user()
    seed_notes(client, token)

    results = client.get(
        "/api/search", params={"q": "raft consensus"}, headers=auth(token)
    ).json()["results"]

    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True)
    assert all(0.0 <= s <= 1.0 for s in scores)


def test_search_respects_the_limit(client, register_user):
    _, token = register_user()
    seed_notes(client, token)

    res = client.get("/api/search", params={"q": "raft", "limit": 1}, headers=auth(token))
    assert len(res.json()["results"]) == 1


def test_search_on_an_empty_library_returns_no_results(client, register_user):
    _, token = register_user()
    body = client.get("/api/search", params={"q": "anything"}, headers=auth(token)).json()
    assert body == {"results": [], "query": "anything", "total": 0}


def test_search_rejects_a_blank_query(client, register_user):
    _, token = register_user()
    assert client.get("/api/search", params={"q": ""}, headers=auth(token)).status_code == 422


def test_search_requires_auth(client):
    assert client.get("/api/search", params={"q": "raft"}).status_code == 401


def test_search_never_returns_another_users_note(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    seed_notes(client, token_a)

    body = client.get("/api/search", params={"q": "raft consensus"}, headers=auth(token_b)).json()
    assert body["results"] == []


# -- GET /api/stats ------------------------------------------------------------

def test_stats_counts_only_the_callers_chunks(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    seed_notes(client, token_a)
    ingest(client, token_b, NOTES[0])

    a = client.get("/api/stats", headers=auth(token_a)).json()
    b = client.get("/api/stats", headers=auth(token_b)).json()

    assert a["total_chunks"] == 3
    assert b["total_chunks"] == 1
    assert a["strong"] + a["fading"] + a["weak"] + a["critical"] == 3


def test_stats_on_an_empty_library(client, register_user):
    _, token = register_user()
    body = client.get("/api/stats", headers=auth(token)).json()
    assert body == {
        "total_chunks": 0, "avg_retention": 1.0,
        "strong": 0, "fading": 0, "weak": 0, "critical": 0,
    }


def test_stats_buckets_a_decayed_chunk_as_critical(client, register_user):
    from datetime import datetime, timedelta, timezone

    _, token = register_user()
    uid = _user_id_from(token)
    long_ago = datetime.now(tz=timezone.utc) - timedelta(days=400)
    insert_chunk(
        content="An old note nobody has opened in over a year.",
        source_file="old.md", complexity_score=0.5, user_id=uid,
        created_at=long_ago, last_accessed=long_ago, access_count=0,
    )

    body = client.get("/api/stats", headers=auth(token)).json()
    assert body["total_chunks"] == 1
    assert body["critical"] == 1
    assert body["avg_retention"] < 0.2


def test_stats_requires_auth(client):
    assert client.get("/api/stats").status_code == 401


# -- GET /api/health -----------------------------------------------------------

def test_health_groups_by_category(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    for category in ("Computer Science", "Computer Science", "Personal"):
        insert_chunk(
            content=f"A note filed under {category}.", source_file="n.md",
            complexity_score=0.5, user_id=uid,
        )
    import database.db as db
    for row, category in zip(get_all_chunks(uid), ("Personal", "Computer Science", "Computer Science")):
        db.update_chunk_category(row["id"], category)

    body = client.get("/api/health", headers=auth(token)).json()
    by_name = {c["name"]: c for c in body["categories"]}

    assert body["total_chunks"] == 3
    assert by_name["Computer Science"]["total"] == 2
    assert by_name["Personal"]["total"] == 1
    for category in body["categories"]:
        buckets = sum(category[b] for b in ("strong", "fading", "weak", "critical"))
        assert buckets == category["total"] == category["count"]
        assert category["urgency"] in {"low", "medium", "high"}


def test_health_time_offset_projects_decay_forward(client, register_user):
    _, token = register_user()
    seed_notes(client, token)

    now = client.get("/api/health", headers=auth(token)).json()
    later = client.get(
        "/api/health", params={"time_offset_hours": 24 * 365}, headers=auth(token)
    ).json()

    assert later["avg_retention"] < now["avg_retention"]
    assert later["time_offset_hours"] == 24 * 365
    assert later["forgotten_count"] >= now["forgotten_count"]


def test_health_on_an_empty_library(client, register_user):
    _, token = register_user()
    body = client.get("/api/health", headers=auth(token)).json()
    assert body["categories"] == []
    assert body["total_chunks"] == 0
    assert body["avg_retention"] == 1.0


def test_health_rejects_a_negative_offset(client, register_user):
    _, token = register_user()
    res = client.get("/api/health", params={"time_offset_hours": -1}, headers=auth(token))
    assert res.status_code == 422


def test_health_sees_only_the_callers_chunks(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    seed_notes(client, token_a)

    assert client.get("/api/health", headers=auth(token_b)).json()["total_chunks"] == 0


def test_health_requires_auth(client):
    assert client.get("/api/health").status_code == 401


# -- GET /api/discovery --------------------------------------------------------

def test_discovery_is_empty_on_an_empty_library(client, register_user):
    _, token = register_user()
    assert client.get("/api/discovery", headers=auth(token)).json() == {"has_discovery": False}


def test_discovery_ignores_freshly_created_chunks(client, register_user):
    """A note read seconds ago is not at risk, so there is nothing to surface."""
    _, token = register_user()
    seed_notes(client, token)
    assert client.get("/api/discovery", headers=auth(token)).json()["has_discovery"] is False


def test_discovery_surfaces_a_fading_chunk(client, register_user):
    from datetime import datetime, timedelta, timezone

    _, token = register_user()
    uid = _user_id_from(token)
    fading = datetime.now(tz=timezone.utc) - timedelta(days=12)
    insert_chunk(
        content="A note drifting into the at-risk band.", source_file="fading.md",
        complexity_score=0.5, user_id=uid,
        created_at=fading, last_accessed=fading, access_count=1,
    )

    body = client.get("/api/discovery", headers=auth(token)).json()
    assert body["has_discovery"] is True
    assert body["chunk"]["content"] == "A note drifting into the at-risk band."
    assert body["reason"]
    # The band the endpoint documents: at risk, but not already gone.
    assert 0.1 <= body["chunk"]["retention"] <= 0.65


def test_discovery_never_surfaces_another_users_chunk(client, register_user):
    from datetime import datetime, timedelta, timezone

    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a = _user_id_from(token_a)
    fading = datetime.now(tz=timezone.utc) - timedelta(days=12)
    insert_chunk(
        content="User A's private fading note.", source_file="fading.md",
        complexity_score=0.5, user_id=uid_a,
        created_at=fading, last_accessed=fading, access_count=1,
    )

    assert client.get("/api/discovery", headers=auth(token_a)).json()["has_discovery"] is True
    assert client.get("/api/discovery", headers=auth(token_b)).json() == {"has_discovery": False}


def test_discovery_requires_auth(client):
    assert client.get("/api/discovery").status_code == 401


# -- GET /api/folders ----------------------------------------------------------

def test_folders_is_empty_before_anything_is_filed(client, register_user):
    _, token = register_user()
    assert client.get("/api/folders", headers=auth(token)).json() == {"folders": []}


def test_folders_lists_distinct_names(client, register_user):
    _, token = register_user()
    uid = _user_id_from(token)
    ids = seed_notes(client, token)
    set_chunk_folder(ids[0], "Systems", uid)
    set_chunk_folder(ids[1], "Recipes", uid)
    set_chunk_folder(ids[2], "Systems", uid)

    folders = client.get("/api/folders", headers=auth(token)).json()["folders"]
    assert sorted(folders) == ["Recipes", "Systems"]


def test_folders_are_scoped_per_user(client, register_user):
    _, token_a = register_user("a")
    _, token_b = register_user("b")
    uid_a = _user_id_from(token_a)
    ids_a = seed_notes(client, token_a)
    set_chunk_folder(ids_a[0], "A-only", uid_a)

    assert client.get("/api/folders", headers=auth(token_a)).json()["folders"] == ["A-only"]
    assert client.get("/api/folders", headers=auth(token_b)).json()["folders"] == []


def test_folders_requires_auth(client):
    assert client.get("/api/folders").status_code == 401
