"""Lightweight in-memory sliding-window rate limiter (AUDIT P1-2).

Honest scope: this is per-process. It protects a single-node deployment against
brute-force auth and runaway LLM spend. For a multi-instance deployment, replace
the backing store with Redis (the dependency interface stays the same).

Config:
  DORY_RATE_LIMIT_PER_MIN         per-bucket requests/min/client-IP (default 60). 0 disables.
  DORY_GLOBAL_RATE_LIMIT_PER_MIN  global requests/min/client-IP across all routes (default 100). 0 disables.
Routes may also pass an explicit per-route limit, e.g. rate_limit("ingest", limit=10).
The limiter is inert when DORY_ENV is dev/development so local dev and the test
suite are not throttled; production gets protection by default.
"""

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)
_WINDOW_SECONDS = 60.0
_GLOBAL_LIMIT_DEFAULT = 100


def _is_dev() -> bool:
    return os.getenv("DORY_ENV", "production").lower() in {"dev", "development"}


def _limit() -> int:
    try:
        return int(os.getenv("DORY_RATE_LIMIT_PER_MIN", "60"))
    except ValueError:
        return 60


def _global_limit() -> int:
    try:
        return int(os.getenv("DORY_GLOBAL_RATE_LIMIT_PER_MIN", str(_GLOBAL_LIMIT_DEFAULT)))
    except ValueError:
        return _GLOBAL_LIMIT_DEFAULT


def _enabled() -> bool:
    # Inert in local dev; active by default everywhere else (secure by default).
    if _is_dev():
        return False
    return _limit() > 0


def _record_hit(key: str, limit: int) -> bool:
    """Sliding-window check against the shared store. Returns True if the request
    is allowed, False if the client exceeded `limit` hits in the trailing window."""
    now = time.monotonic()
    with _lock:
        dq = _hits[key]
        while dq and now - dq[0] > _WINDOW_SECONDS:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True


def rate_limit(bucket: str, limit: int | None = None):
    """Return a FastAPI dependency that throttles `bucket` per client IP. Pass
    `limit` to override DORY_RATE_LIMIT_PER_MIN for this route (e.g. ingest=10)."""

    def dependency(request: Request) -> None:
        if not _enabled():
            return
        effective = limit if limit is not None else _limit()
        if effective <= 0:
            return
        client_ip = request.client.host if request.client else "unknown"
        if not _record_hit(f"{bucket}:{client_ip}", effective):
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")

    return dependency


def global_limit_exceeded(request: Request) -> bool:
    """Global per-IP cap across every endpoint, backed by the same store. Returns
    True when the caller is over budget (so the caller should respond 429). Inert
    in dev and when DORY_GLOBAL_RATE_LIMIT_PER_MIN is 0."""
    if _is_dev():
        return False
    limit = _global_limit()
    if limit <= 0:
        return False
    client_ip = request.client.host if request.client else "unknown"
    return not _record_hit(f"__global__:{client_ip}", limit)
