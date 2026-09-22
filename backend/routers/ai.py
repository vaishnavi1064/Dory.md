"""LLM-backed note tools: summarize, expand, optimize.

These are the only endpoints that cannot degrade to a useful answer without a
model — quiz generation falls back to a question bank and categorization falls
back to "Other", but there is no honest offline way to summarize a note, and
inventing one would be worse than saying so. They therefore fail *cleanly*:

  503  no API key configured for LLM_PROVIDER — the feature is off, not broken
  502  a key is set but the provider call failed (network, quota, bad key)

Neither is a 500. Before this, an unset GROQ_API_KEY reached the Groq SDK as an
empty bearer token and blew up inside httpx with `Illegal header value b'Bearer '`,
which surfaced to the client as an opaque "Internal server error".
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ratelimit import rate_limit
from routers.deps import get_current_user_id
from intelligence.llm import LLMNotConfigured, get_llm

router = APIRouter()
logger = logging.getLogger("dory.ai")

# LLM endpoints are gated by both auth and a rate limit (paid-API spend control).
_ai_guard = [Depends(rate_limit("ai"))]

_NOT_CONFIGURED = (
    "AI features are not configured on this server. Set an API key for your "
    "LLM_PROVIDER (e.g. GROQ_API_KEY) to enable summarize, expand and optimize."
)
_UPSTREAM_FAILED = "The AI provider could not be reached. Please try again shortly."


def _complete(prompt: str, system: str, label: str) -> str:
    """Run one completion, mapping every failure mode to a clean HTTP status."""
    try:
        return get_llm().complete(prompt, system=system).strip()
    except LLMNotConfigured:
        # Expected on any deployment without a key — log quietly, not as an error.
        logger.info("ai_%s unavailable: no LLM key configured", label)
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED)
    except Exception:
        logger.exception("ai_%s failed against the LLM provider", label)
        raise HTTPException(status_code=502, detail=_UPSTREAM_FAILED)


class SummarizeRequest(BaseModel):
    content: str


class ExpandRequest(BaseModel):
    content: str


class OptimizeRequest(BaseModel):
    original: str
    expanded: str


@router.post("/ai/summarize", dependencies=_ai_guard)
def summarize_note(body: SummarizeRequest, user_id: str = Depends(get_current_user_id)):
    result = _complete(
        f"Summarize these study notes in 3-5 clear, concise sentences. Return only the summary, no preamble:\n\n{body.content[:4000]}",
        system="You are a concise study assistant. Create clear, accurate summaries that capture the key points.",
        label="summarize",
    )
    return {"summary": result}


@router.post("/ai/expand", dependencies=_ai_guard)
def expand_note(body: ExpandRequest, user_id: str = Depends(get_current_user_id)):
    result = _complete(
        f"""Generate comprehensive, detailed study notes on the topic covered in these notes.
Include: definitions, key concepts, examples, common patterns, edge cases, and deeper insights.
Format with ## headers and bullet points for clarity. Be thorough and educational.

Original notes:
{body.content[:3000]}

Write detailed study notes on this topic:""",
        system="You are an expert educator. Create comprehensive, well-structured study notes that go deep into the topic.",
        label="expand",
    )
    return {"expanded": result}


@router.post("/ai/optimize", dependencies=_ai_guard)
def optimize_note(body: OptimizeRequest, user_id: str = Depends(get_current_user_id)):
    result = _complete(
        f"""You have two notes on the same topic. Combine them into one optimized study note.

Rules:
- Keep the best insights and examples from both
- Remove redundancy
- Structure with ## headers and bullet points
- Be concise but comprehensive
- Preserve any specific facts, formulas, or code from the original

ORIGINAL NOTE:
{body.original[:2000]}

AI-EXPANDED NOTE:
{body.expanded[:2000]}

Write the optimized combined note:""",
        system="You are an expert at synthesizing study notes. Create the best possible combined note.",
        label="optimize",
    )
    return {"optimized": result}
