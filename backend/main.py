import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).parent / ".env")

from core.embeddings import warm_model
from database.db import init_db
from routers import ai, auth, chunks, discovery, fading, health, ingest, quiz, review, search, seed, stats
from routers.auth import setup_demo_user
from services.category_service import classify_all_uncategorized

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    setup_demo_user()
    if os.getenv("DORY_SKIP_WARMUP") != "1":
        warm_model()
        threading.Thread(target=classify_all_uncategorized, daemon=True).start()
    yield

app = FastAPI(title="Dory.md API", version="1.0.0", lifespan=lifespan)

_CORS_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"https?://(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?|https://[\w-]+\.vercel\.app",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_CORS_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

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

@app.get("/")
def root():
    return {"status": "ok", "service": "Dory.md"}
