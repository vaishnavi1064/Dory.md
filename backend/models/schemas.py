from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ── Ingest ────────────────────────────────────────────────────────────────────

class IngestResponse(BaseModel):
    chunks_created: int
    source: str
    message: str = "Ingestion complete. Category classification running in background."


# ── Chunk / Fading Feed ───────────────────────────────────────────────────────

class ChunkOut(BaseModel):
    chunk_id: str
    content: str
    source_file: str
    category: Optional[str]
    retention: float
    status: str  # strong | fading | weak | critical
    last_accessed: str          # human-readable, e.g. "5mo ago"
    last_accessed_iso: str      # ISO 8601 for client-side date math
    access_count: int
    folder: Optional[str] = None


class ChunkDetailOut(BaseModel):
    chunk_id: str
    content: str
    source_file: str
    folder: Optional[str] = None


class UpdateChunkRequest(BaseModel):
    content: str


class BulkDeleteRequest(BaseModel):
    chunk_ids: list[str]


class FolderRequest(BaseModel):
    folder: Optional[str] = None


class FadingResponse(BaseModel):
    chunks: list[ChunkOut]
    total_fading: int


class ChunksResponse(BaseModel):
    chunks: list[ChunkOut]
    total: int


# ── Health / Time Machine ─────────────────────────────────────────────────────

class CategoryHealth(BaseModel):
    name: str
    avg_retention: float
    strong: int
    fading: int
    weak: int
    critical: int
    total: int
    count: int      # alias for total — matches frontend CategoryStat.count
    urgency: str    # low | medium | high


class HealthResponse(BaseModel):
    categories: list[CategoryHealth]
    forgotten_count: int
    total_chunks: int
    avg_retention: float
    projected_date: str
    time_offset_hours: float


# ── Search / Discovery ────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    context: str
    limit: int = 5


class SearchResult(BaseModel):
    chunk_id: str
    content: str
    source_file: str
    category: Optional[str]
    retention: float
    status: str
    relevance_score: float
    is_discovery: bool = False
    time_ago: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    discovery: Optional[SearchResult] = None


# ── Review ────────────────────────────────────────────────────────────────────

class ReviewResponse(BaseModel):
    chunk_id: str
    new_retention: float
    access_count: int
    message: str


class ReviewCard(BaseModel):
    """A chunk ready to be reviewed in a study session."""
    chunk_id: str
    content: str
    source_file: str
    category: Optional[str]
    fsrs_state: int        # 1=Learning, 2=Review, 3=Relearning
    fsrs_due: str          # ISO timestamp
    fsrs_stability: Optional[float]
    fsrs_difficulty: Optional[float]
    fsrs_last_review: Optional[str]


class ReviewQueueResponse(BaseModel):
    cards: list[ReviewCard]
    due_count: int          # total due (may exceed `cards` if limit was applied)


class GradeRequest(BaseModel):
    chunk_id: str
    grade: int              # 1=Again, 2=Hard, 3=Good, 4=Easy


class GradeResponse(BaseModel):
    chunk_id: str
    grade: int
    next_due: str           # ISO timestamp of when this card will reappear
    stability: Optional[float]
    difficulty: Optional[float]
    state: int


# ── Stats ─────────────────────────────────────────────────────────────────────

class StatsResponse(BaseModel):
    total_chunks: int
    avg_retention: float
    strong: int
    fading: int
    weak: int
    critical: int


# ── Quiz ─────────────────────────────────────────────────────────────────────

class QuizQuestion(BaseModel):
    id: str                 # question id (= chunk_id for lookup in submit)
    chunk_id: str
    question: str
    options: list[str]
    correct_index: int
    difficulty: str         # easy | medium | hard (derived from complexity_score)
    category: str
    retention: float
    source_file: str
    hint: Optional[str] = None


class QuizStartResponse(BaseModel):
    session_id: str
    questions: list[QuizQuestion]
    created_at: str


class QuizAnswerRequest(BaseModel):
    session_id: str
    chunk_id: str
    selected_index: int
    correct_index: int


class QuizAnswerResponse(BaseModel):
    correct: bool
    correct_index: int
    new_retention: float
    message: str


class QuizSubmitAnswer(BaseModel):
    question_id: str
    selected_index: int
    time_taken_ms: int = 0


class QuizSubmitRequest(BaseModel):
    answers: list[QuizSubmitAnswer]


class QuizResultItem(BaseModel):
    question_id: str
    correct: bool
    selected_index: int
    correct_index: int
    stability_delta: float


class QuizSubmitResponse(BaseModel):
    session_id: str
    score: int
    total: int
    results: list[QuizResultItem]
    xp_earned: int
    streaks: int


# ── Text ingest (JSON body — frontend IngestResponse shape) ──────────────────

class TextIngestRequest(BaseModel):
    content: str
    source_type: str = "note"
    source_name: str = "manual_entry"


class TextIngestResponse(BaseModel):
    chunk_id: str
    category: str
    stability_S: float
    complexity_k: float
    message: str
