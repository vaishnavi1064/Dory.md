import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.decay_engine import calculate_retention
from database.db import (
    create_quiz_session,
    get_lowest_retention_chunks,
    update_chunk_access_by,
)
from models.schemas import (
    QuizAnswerRequest,
    QuizAnswerResponse,
    QuizQuestion,
    QuizStartResponse,
    QuizSubmitRequest,
    QuizSubmitResponse,
    QuizResultItem,
)
from routers.deps import get_current_user_id
from services.llm_service import get_llm

# In-memory store: {session_id: {question_id: {correct_index, chunk_id}}}
# Process-scoped, fine for hackathon
_session_store: dict[str, dict[str, dict]] = {}

router = APIRouter()

# Fallback questions used if LLM is unavailable
_FALLBACK_QUESTIONS = [
    {
        "question": "What is the primary purpose of spaced repetition?",
        "options": [
            "To memorize information faster in one session",
            "To review information at increasing intervals to strengthen memory",
            "To organize notes by topic",
            "To summarize long documents automatically",
        ],
        "correct_index": 1,
    },
    {
        "question": "According to Ebbinghaus, how much information is forgotten after one week without review?",
        "options": ["~10%", "~25%", "~75%", "~99%"],
        "correct_index": 2,
    },
    {
        "question": "What does the stability factor S represent in the decay formula?",
        "options": [
            "The size of the document",
            "How often a chunk was reviewed (durability of memory)",
            "The complexity of the content",
            "The time since the note was created",
        ],
        "correct_index": 1,
    },
    {
        "question": "Which retention score range is classified as 'Critical' in Dory.md?",
        "options": ["0.8 – 1.0", "0.5 – 0.8", "0.2 – 0.5", "0.0 – 0.2"],
        "correct_index": 3,
    },
    {
        "question": "What does the Time Machine slider project?",
        "options": [
            "The history of your notes",
            "Future knowledge retention using the decay formula",
            "Your weekly study schedule",
            "The similarity between documents",
        ],
        "correct_index": 1,
    },
]

_MCQ_SYSTEM = (
    "You are a quiz generator. Given a text chunk, generate exactly 1 multiple-choice question "
    "that tests understanding of the content. Return ONLY valid JSON with this exact structure: "
    '{"question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "correct_index": 0} '
    "where correct_index is 0-based. No markdown, no explanation."
)


def _difficulty(complexity_score: float) -> str:
    if complexity_score < 0.33:
        return "easy"
    if complexity_score < 0.66:
        return "medium"
    return "hard"


def _generate_question(chunk_id: str, content: str, access_count: int, complexity_score: float, source_file: str, category: str, fallback_q: dict) -> QuizQuestion:
    last_accessed = datetime.now(tz=timezone.utc)
    r = calculate_retention(last_accessed, access_count, complexity_score)

    llm = get_llm()
    result = llm.complete_json(
        prompt=f"Generate a quiz question for this text:\n\n{content[:600]}",
        system=_MCQ_SYSTEM,
        fallback=fallback_q,
    )

    question = result.get("question", fallback_q["question"])
    options = result.get("options", fallback_q["options"])
    correct_index = int(result.get("correct_index", fallback_q["correct_index"]))

    if not isinstance(options, list) or len(options) < 2:
        options = fallback_q["options"]
        correct_index = fallback_q["correct_index"]
    correct_index = max(0, min(correct_index, len(options) - 1))

    return QuizQuestion(
        id=chunk_id,
        chunk_id=chunk_id,
        question=question,
        options=options,
        correct_index=correct_index,
        difficulty=_difficulty(complexity_score),
        category=category or "general",
        retention=round(r, 4),
        source_file=source_file,
    )


@router.post("/quiz/start", response_model=QuizStartResponse)
def start_quiz(user_id: str = Depends(get_current_user_id)):
    rows = get_lowest_retention_chunks(user_id, limit=5)
    session_id = create_quiz_session(user_id, total=len(rows) or 5)

    now_iso = datetime.now(tz=timezone.utc).isoformat()

    if not rows:
        questions = [
            QuizQuestion(
                id=f"fallback-{i}",
                chunk_id=f"fallback-{i}",
                question=q["question"],
                options=q["options"],
                correct_index=q["correct_index"],
                difficulty="medium",
                category="general",
                retention=0.3,
                source_file="demo",
            )
            for i, q in enumerate(_FALLBACK_QUESTIONS)
        ]
        _session_store[session_id] = {
            f"fallback-{i}": {"correct_index": q["correct_index"], "chunk_id": f"fallback-{i}"}
            for i, q in enumerate(_FALLBACK_QUESTIONS)
        }
        return QuizStartResponse(session_id=session_id, questions=questions, created_at=now_iso)

    questions = []
    session_map = {}
    for i, row in enumerate(rows):
        fallback = _FALLBACK_QUESTIONS[i % len(_FALLBACK_QUESTIONS)]
        q = _generate_question(
            chunk_id=row["id"],
            content=row["content"],
            access_count=row["access_count"],
            complexity_score=row["complexity_score"],
            source_file=row["source_file"],
            category=row["category"] or "general",
            fallback_q=fallback,
        )
        questions.append(q)
        session_map[q.id] = {"correct_index": q.correct_index, "chunk_id": row["id"]}

    _session_store[session_id] = session_map
    return QuizStartResponse(session_id=session_id, questions=questions, created_at=now_iso)


@router.post("/quiz/answer", response_model=QuizAnswerResponse)
def submit_answer(body: QuizAnswerRequest, user_id: str = Depends(get_current_user_id)):
    correct = body.selected_index == body.correct_index
    new_r = 0.0
    if correct and not body.chunk_id.startswith("fallback-"):
        updated = update_chunk_access_by(body.chunk_id, delta=2, user_id=user_id, source="quiz")
        if updated is not None:
            last_accessed = datetime.now(tz=timezone.utc)
            new_r = calculate_retention(last_accessed, updated["access_count"], updated["complexity_score"])

    return QuizAnswerResponse(
        correct=correct,
        correct_index=body.correct_index,
        new_retention=round(new_r, 4),
        message="Memory revived!" if correct else "Keep reviewing — you'll get it next time.",
    )


@router.post("/quiz/{session_id}/submit", response_model=QuizSubmitResponse)
def submit_quiz(session_id: str, body: QuizSubmitRequest, user_id: str = Depends(get_current_user_id)):
    """Batch answer submission — matches frontend POST /api/quiz/{sessionId}/submit."""
    session_map = _session_store.get(session_id, {})

    results = []
    score = 0
    max_streak = 0
    current_streak = 0

    for answer in body.answers:
        qid = answer.question_id
        meta = session_map.get(qid, {})
        correct_index = meta.get("correct_index", 0)
        chunk_id = meta.get("chunk_id", qid)
        correct = answer.selected_index == correct_index

        stability_delta = 0.0
        if correct and not chunk_id.startswith("fallback-"):
            updated = update_chunk_access_by(chunk_id, delta=2, user_id=user_id, source="quiz")
            if updated is not None:
                stability_delta = 12.0
                score += 1
                current_streak += 1
                max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0
            if not chunk_id.startswith("fallback-") and not correct:
                stability_delta = -4.0

        results.append(QuizResultItem(
            question_id=qid,
            correct=correct,
            selected_index=answer.selected_index,
            correct_index=correct_index,
            stability_delta=stability_delta,
        ))

    return QuizSubmitResponse(
        session_id=session_id,
        score=score,
        total=len(body.answers),
        results=results,
        xp_earned=score * 50,
        streaks=max_streak,
    )
