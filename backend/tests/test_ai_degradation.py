"""AI endpoints must degrade cleanly when no LLM key is configured.

With GROQ_API_KEY unset the Groq SDK used to send `Authorization: Bearer ` and
httpx rejected it as an illegal header value, deep inside the provider, so every
one of these routes answered 500 "Internal server error" on a plain
un-keyed deployment — the default state of a fresh clone.

The absence of exactly these tests is why that survived: test_ai_auth.py asserted
the auth gate and nothing else, so nothing ever called the routes with a token.
"""

import pytest

from intelligence.llm import LLMNotConfigured
from intelligence.llm.provider import LLMService

# Every provider key that could accidentally be present in the developer's
# environment and turn a "no key" test into a real API call.
_KEY_ENVS = ("GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")

ROUTES = [
    ("/api/ai/summarize", {"content": "Binary search halves the range each step."}),
    ("/api/ai/expand", {"content": "Binary search halves the range each step."}),
    ("/api/ai/optimize", {"original": "Binary search.", "expanded": "Binary search, at length."}),
]


@pytest.fixture
def no_llm_key(monkeypatch):
    """A deployment with no model configured: groq provider, no keys anywhere."""
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    for name in _KEY_ENVS:
        monkeypatch.delenv(name, raising=False)
    # get_llm() caches a singleton built from whatever env existed first.
    import intelligence.llm.provider as provider
    monkeypatch.setattr(provider, "_service", None)


@pytest.mark.parametrize("path,body", ROUTES, ids=[r[0].split("/")[-1] for r in ROUTES])
def test_route_returns_503_not_500_without_a_key(client, register_user, no_llm_key, path, body):
    _, token = register_user()
    res = client.post(path, json=body, headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 503, f"{path} -> {res.status_code} {res.text}"
    detail = res.json()["detail"]
    assert "not configured" in detail.lower()
    # The message has to tell the operator what to actually do about it.
    assert "LLM_PROVIDER" in detail and "API key" in detail


@pytest.mark.parametrize("path,body", ROUTES, ids=[r[0].split("/")[-1] for r in ROUTES])
def test_route_returns_502_when_the_provider_itself_fails(
    client, register_user, monkeypatch, path, body
):
    """A configured key that fails at call time is an upstream problem, not a bug."""
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "sk-test-key-that-is-never-used")

    import routers.ai as ai_router

    class Boom:
        def complete(self, prompt, system=""):
            raise RuntimeError("connection reset by peer")

    monkeypatch.setattr(ai_router, "get_llm", lambda: Boom())

    _, token = register_user()
    res = client.post(path, json=body, headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 502, f"{path} -> {res.status_code} {res.text}"
    assert "try again" in res.json()["detail"].lower()
    # The upstream error text must not leak to the client.
    assert "connection reset" not in res.text


@pytest.mark.parametrize("path,body", ROUTES, ids=[r[0].split("/")[-1] for r in ROUTES])
def test_route_still_works_when_a_key_is_present(client, register_user, monkeypatch, path, body):
    """The happy path must survive the error handling that was wrapped around it."""
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "sk-test-key-that-is-never-used")

    import routers.ai as ai_router

    class Stub:
        def complete(self, prompt, system=""):
            return "  a model wrote this  "

    monkeypatch.setattr(ai_router, "get_llm", lambda: Stub())

    _, token = register_user()
    res = client.post(path, json=body, headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 200, res.text
    # Whatever the field is called on this route, the text is trimmed and passed through.
    assert list(res.json().values()) == ["a model wrote this"]


# -- The provider-level contract the routes depend on -------------------------

def test_is_configured_is_false_without_a_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert LLMService().is_configured() is False


def test_is_configured_ignores_a_blank_key(monkeypatch):
    """`GROQ_API_KEY=` in a .env file is the exact shape of the original bug."""
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "   ")
    assert LLMService().is_configured() is False


def test_is_configured_is_true_for_keyless_local_ollama(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert LLMService().is_configured() is True


def test_complete_raises_a_named_error_rather_than_an_sdk_failure(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(LLMNotConfigured) as excinfo:
        LLMService().complete("anything")
    assert "GROQ_API_KEY" in str(excinfo.value)


def test_complete_json_still_swallows_the_missing_key(monkeypatch):
    """Quiz generation and categorization must keep degrading silently."""
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert LLMService().complete_json("anything", fallback={"ok": True}) == {"ok": True}
