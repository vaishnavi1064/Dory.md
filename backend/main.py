import logging
import os
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

# Make the sibling `intelligence/` package importable. The backend consumes the
# intelligence domain layer through its public interfaces; it lives at the repo
# root next to backend/, so the repo root must be on sys.path. (For independent
# deployment, `pip install -e intelligence/` achieves the same — see ARCHITECTURE_REFACTOR.md.)
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv(Path(__file__).parent / ".env")

from intelligence.embeddings import warm_model
from database.db import get_connection, init_db, purge_expired_refresh_tokens
from observability import setup_logging
from ratelimit import global_limit_exceeded
from routers import account, ai, auth, chunks, discovery, fading, health, ingest, meetings, mood, quiz, review, search, seed, stats
from routers.auth import setup_demo_user
from routers.deps import require_secret_configured
from services.category_service import classify_all_uncategorized

setup_logging()
logger = logging.getLogger("dory")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast on misconfiguration instead of 500-ing every auth request later
    # (AUDIT P1-7): in any non-dev environment a JWT secret MUST be configured.
    require_secret_configured()
    init_db()
    setup_demo_user()
    purge_expired_refresh_tokens()  # AUDIT P0-5
    if os.getenv("DORY_SKIP_WARMUP") != "1":
        warm_model()
        threading.Thread(target=classify_all_uncategorized, daemon=True).start()
    logger.info("Dory.md API started (env=%s)", os.getenv("DORY_ENV", "production"))
    yield


app = FastAPI(title="Dory.md API", version="1.0.0", lifespan=lifespan)

# CORS: explicit env-driven allow-list (AUDIT P1-3). Set DORY_CORS_ORIGINS to a
# comma-separated list of exact origins in production, e.g.
#   DORY_CORS_ORIGINS=https://dory-md-fork.vercel.app,https://app.dory.md
# PUT/PATCH are kept because chunks support edit (PUT /chunks/{id}) and folder
# move (PATCH /chunks/{id}/folder).
_cors_origins = [
    o.strip()
    for o in os.environ.get("DORY_CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def global_rate_limit(request: Request, call_next):
    """Global per-IP request cap (AUDIT P1-2), reusing the shared limiter store.
    CORS preflight (OPTIONS) is exempt so the SPA's preflights don't burn budget.
    Inert in dev; tune with DORY_GLOBAL_RATE_LIMIT_PER_MIN (default 100)."""
    if request.method != "OPTIONS" and global_limit_exceeded(request):
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please slow down."},
        )
    return await call_next(request)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    """Attach a request id and log timing/status for every request (AUDIT P1-1)."""
    request_id = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed = (time.perf_counter() - start) * 1000
        logger.exception("request_failed id=%s %s %s after %.1fms", request_id, request.method, request.url.path, elapsed)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."}, headers={"X-Request-ID": request_id})
    elapsed = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info("id=%s %s %s -> %s %.1fms", request_id, request.method, request.url.path, response.status_code, elapsed)
    return response


app.include_router(auth.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(fading.router, prefix="/api")
app.include_router(chunks.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(discovery.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(review.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(quiz.router, prefix="/api")
app.include_router(seed.router, prefix="/api")
app.include_router(account.router, prefix="/api")
app.include_router(mood.router, prefix="/api")
app.include_router(meetings.router, prefix="/api")


@app.get("/")
def root():
    return {"status": "ok", "service": "Dory.md"}


@app.get("/livez")
def livez():
    """Liveness probe — process is up. No dependencies touched (AUDIT P1-8)."""
    return {"status": "alive"}


@app.get("/readyz")
def readyz():
    """Readiness probe — can we reach the database?"""
    try:
        conn = get_connection()
        conn.execute("SELECT 1")
        conn.close()
        return {"status": "ready"}
    except Exception:
        logger.exception("readiness check failed")
        return JSONResponse(status_code=503, content={"status": "not_ready"})
