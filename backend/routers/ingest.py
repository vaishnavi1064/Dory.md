import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from intelligence.domain import chunk_text as _chunk_text, complexity_score
from intelligence.embeddings import embed_texts
from intelligence.ranking import display_complexity_k, display_stability
from intelligence.retrieval import add_chunks
from database.db import delete_chunk, insert_chunk
from models.schemas import IngestResponse, TextIngestRequest, TextIngestResponse
from parsers.file_parser import parse
from ratelimit import rate_limit
from routers.deps import get_current_user_id
from services.category_service import classify_and_store

logger = logging.getLogger("dory.ingest")

router = APIRouter()

# ─── Ingest limits ─────────────────────────────────────────────────────────
# Enforced server-side at POST /api/ingest before any parsing or DB writes.
# If you change these values, also update:
#   - The user-visible error message strings below (must stay in sync)
#   - README.md "Privacy → Limits" subsection
#   - backend/tests/test_ingest_limits.py
MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024      # 10 MB per file
MAX_TOTAL_BYTES = 20 * 1024 * 1024     # 20 MB per request


@router.post(
    "/ingest",
    response_model=IngestResponse,
    dependencies=[Depends(rate_limit("ingest", limit=10))],
)
async def ingest_files(
    files: list[UploadFile],
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail="Too many files (max 20)")

    # Read + validate every file up front so size limits are enforced before any
    # parsing, embedding, or DB writes happen.
    payloads: list[tuple[str, bytes]] = []
    total_bytes = 0
    for upload in files:
        raw = await upload.read()
        if len(raw) > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail="File too large (max 10MB)")
        total_bytes += len(raw)
        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=400, detail="Total upload exceeds 20MB")
        payloads.append((upload.filename or "upload.txt", raw))

    total_chunks = 0
    last_source = ""
    loop = asyncio.get_running_loop()
    ingested_chunk_ids: list[str] = []
    ingested_file_count = 0

    for idx, (filename, raw) in enumerate(payloads):
        text = parse(filename, raw)
        if not text.strip():
            continue

        chunks = _chunk_text(text)
        if not chunks:
            continue

        scores = [complexity_score(c) for c in chunks]
        # Embedding is CPU-bound (sentence-transformers); run it in the default
        # threadpool so it doesn't block the event loop for other requests.
        embeddings = await loop.run_in_executor(None, embed_texts, chunks)

        chunk_ids: list[str] = []
        for chunk_text, score, emb in zip(chunks, scores, embeddings):
            cid = insert_chunk(
                content=chunk_text,
                source_file=filename,
                complexity_score=score,
                user_id=user_id,
            )
            chunk_ids.append(cid)

        metadatas = [
            {"user_id": user_id, "chunk_id": cid, "source_file": filename}
            for cid in chunk_ids
        ]
        # Dual-write integrity with per-file atomicity: if the vector store write
        # fails, roll back ONLY this file's rows. Files already ingested stay
        # (they're consistent across both stores); the remaining files are reported
        # as skipped so the client can retry just the failed + skipped ones.
        try:
            add_chunks(chunk_ids, embeddings, metadatas)
        except Exception:
            for cid in chunk_ids:
                delete_chunk(cid, user_id)
            skipped_files = [fn for fn, _ in payloads[idx + 1:]]
            logger.exception(
                "Vector store write failed for %s; rolled back %d chunk(s); %d file(s) skipped",
                filename, len(chunk_ids), len(skipped_files),
            )
            return JSONResponse(
                status_code=500,
                content={
                    "ingested": ingested_chunk_ids,
                    "failed": {
                        "filename": filename,
                        "reason": "Vector store write failed",
                        "rolled_back_chunk_ids": chunk_ids,
                    },
                    "skipped_files": skipped_files,
                    "message": (
                        f"Ingest stopped at '{filename}'. {ingested_file_count} files were ingested, "
                        f"1 failed and rolled back, {len(skipped_files)} were skipped. "
                        "You can safely retry the failed and skipped files."
                    ),
                },
            )

        for cid, chunk_text in zip(chunk_ids, chunks):
            background_tasks.add_task(classify_and_store, cid, chunk_text)

        ingested_chunk_ids.extend(chunk_ids)
        ingested_file_count += 1
        total_chunks += len(chunk_ids)
        last_source = filename

    return IngestResponse(chunks_created=total_chunks, source=last_source)


@router.post(
    "/ingest/text",
    response_model=TextIngestResponse,
    dependencies=[Depends(rate_limit("ingest", limit=10))],
)
async def ingest_text(
    body: TextIngestRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """JSON ingest endpoint — matches frontend POST /api/ingest with text content."""
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty.")

    chunks = _chunk_text(body.content)
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not extract any chunks from content.")

    scores = [complexity_score(c) for c in chunks]
    # Embedding is CPU-bound; keep it off the event loop (see ingest_files).
    loop = asyncio.get_running_loop()
    embeddings = await loop.run_in_executor(None, embed_texts, chunks)
    source_name = body.source_name or "manual_entry"

    chunk_ids: list[str] = []
    for chunk_text, score in zip(chunks, scores):
        cid = insert_chunk(
            content=chunk_text,
            source_file=source_name,
            complexity_score=score,
            user_id=user_id,
        )
        chunk_ids.append(cid)

    metadatas = [
        {"user_id": user_id, "chunk_id": cid, "source_file": source_name}
        for cid in chunk_ids
    ]
    # Dual-write integrity: roll back the SQLite rows if the vector store fails.
    # Single payload, so there are no other files to skip — the shape mirrors the
    # batch endpoint with empty ingested/skipped lists.
    try:
        add_chunks(chunk_ids, embeddings, metadatas)
    except Exception:
        for cid in chunk_ids:
            delete_chunk(cid, user_id)
        logger.exception(
            "Vector store write failed for %s; rolled back %d SQLite chunk(s)",
            source_name, len(chunk_ids),
        )
        return JSONResponse(
            status_code=500,
            content={
                "ingested": [],
                "failed": {
                    "filename": source_name,
                    "reason": "Vector store write failed",
                    "rolled_back_chunk_ids": chunk_ids,
                },
                "skipped_files": [],
                "message": (
                    f"Ingest failed for '{source_name}'. The note was rolled back and nothing "
                    "was saved; you can safely retry."
                ),
            },
        )

    for cid, chunk_text in zip(chunk_ids, chunks):
        background_tasks.add_task(classify_and_store, cid, chunk_text)

    first_score = scores[0] if scores else 0.5
    S = display_stability(0)
    k = display_complexity_k(first_score)

    return TextIngestResponse(
        chunk_id=chunk_ids[0],
        category="general",
        stability_S=S,
        complexity_k=k,
        message=f"Ingested {len(chunk_ids)} chunk(s). Category classification running in background.",
    )
