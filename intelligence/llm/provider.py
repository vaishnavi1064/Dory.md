"""
Switchable LLM provider abstraction.

Switch between providers by changing two env vars — no code changes needed:

  LLM_PROVIDER=groq          # Groq cloud API (fast, free tier)
  LLM_MODEL=llama-3.3-70b-versatile

  LLM_PROVIDER=ollama        # local Ollama server (Qwen, Gemma, etc.)
  LLM_MODEL=qwen2.5:7b

  LLM_PROVIDER=anthropic     # Anthropic cloud API
  LLM_MODEL=claude-haiku-4-5-20251001

All callers use a single method:  llm.complete(prompt, system="")
"""

import json
import os

_PROVIDER_DEFAULTS = {
    "groq": "llama-3.3-70b-versatile",
    "ollama": "qwen2.5:7b",
    "anthropic": "claude-haiku-4-5-20251001",
}


class LLMNotConfigured(RuntimeError):
    """No API key for the selected provider.

    Raised by `complete()` instead of letting the provider SDK fail deep in its
    HTTP layer — an empty key produces `Illegal header value b'Bearer '` from
    httpx, which is opaque and surfaces as a 500. Callers that can degrade
    (quiz generation, categorization) swallow it; callers that cannot turn it
    into a clean, actionable response.
    """


# Which env var holds the key for each provider. Ollama runs locally and needs
# no key, so it is absent here and always counts as configured.
_PROVIDER_KEY_ENV = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}


class LLMService:
    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "groq").lower()
        self.model = os.getenv("LLM_MODEL", _PROVIDER_DEFAULTS.get(self.provider, "llama-3.3-70b-versatile"))
        self._client = self._build_client()

    def is_configured(self) -> bool:
        """True when this provider has the credentials it needs to be called.

        Read live rather than cached at construction so a key added to the
        environment is picked up without recreating the module-level singleton.
        """
        key_env = _PROVIDER_KEY_ENV.get(self.provider)
        if key_env is None:
            return True  # ollama / any keyless local provider
        return bool(os.getenv(key_env, "").strip())

    def _build_client(self):
        if self.provider == "groq":
            from groq import Groq
            return Groq(api_key=os.getenv("GROQ_API_KEY", ""))

        if self.provider == "ollama":
            from openai import OpenAI
            base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
            return OpenAI(base_url=base_url, api_key="ollama")

        if self.provider == "anthropic":
            import anthropic
            return anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

        raise ValueError(
            f"Unknown LLM_PROVIDER='{self.provider}'. "
            "Valid options: groq, ollama, anthropic"
        )

    def complete(self, prompt: str, system: str = "") -> str:
        """
        Single unified text completion.
        Always returns the raw string from the model — callers parse JSON themselves.

        Raises LLMNotConfigured when the provider has no API key, so the failure
        is named at the point it is knowable instead of inside the SDK.
        """
        if not self.is_configured():
            raise LLMNotConfigured(
                f"No API key for LLM_PROVIDER={self.provider}. "
                f"Set {_PROVIDER_KEY_ENV[self.provider]} to enable LLM features."
            )

        if self.provider in ("groq", "ollama"):
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            resp = self._client.chat.completions.create(
                model=self.model,
                messages=messages,
            )
            return resp.choices[0].message.content or ""

        if self.provider == "anthropic":
            kwargs = dict(
                model=self.model,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            if system:
                kwargs["system"] = system
            resp = self._client.messages.create(**kwargs)
            return resp.content[0].text

        return ""

    def complete_json(self, prompt: str, system: str = "", fallback: dict | None = None) -> dict:
        """
        Complete and parse the result as JSON.
        Returns fallback dict on any error (safe for BackgroundTasks).
        """
        try:
            raw = self.complete(prompt, system=system)
            # Strip markdown code fences if model wraps JSON in them
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw.strip())
        except Exception:
            return fallback or {}


# Module-level singleton — imported by categorization + quiz generation.
_service: LLMService | None = None


def get_llm() -> LLMService:
    global _service
    if _service is None:
        _service = LLMService()
    return _service
