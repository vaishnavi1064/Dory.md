"""AI endpoints (/summarize, /expand, /optimize) must require authentication.

The endpoints would otherwise let anonymous users burn the team's Groq budget.
We don't actually want to hit the LLM in tests, so we just assert the auth gate.
"""


def test_summarize_requires_auth(client):
    res = client.post("/api/ai/summarize", json={"content": "anything"})
    assert res.status_code == 401


def test_expand_requires_auth(client):
    res = client.post("/api/ai/expand", json={"content": "anything"})
    assert res.status_code == 401


def test_optimize_requires_auth(client):
    res = client.post("/api/ai/optimize", json={"original": "a", "expanded": "b"})
    assert res.status_code == 401
