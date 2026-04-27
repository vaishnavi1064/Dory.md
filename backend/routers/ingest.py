import math

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile

from core import chunker, complexity
from core.embeddings import embed_texts
from database.db import insert_chunk
from models.schemas import IngestResponse, TextIngestRequest, TextIngestResponse
from parsers.file_parser import parse
from routers.deps import get_current_user_id
from services.category_service import classify_and_store
from services.chroma_service import add_chunks

router = APIRouter()

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post("/ingest", response_model=IngestResponse)
async def ingest_files(
    files: list[UploadFile],
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    total_chunks = 0
    last_source = ""

    for upload in files:
        raw = await upload.read()
        if len(raw) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail=f"{upload.filename} exceeds 20 MB limit.")

        text = parse(upload.filename or "upload.txt", raw)
        if not text.strip():
            continue

        chunks = chunker.chunk_text(text)
        if not chunks:
            continue

        scores = [complexity.score(c) for c in chunks]
        embeddings = embed_texts(chunks)

        chunk_ids: list[str] = []
        for chunk_text, score, emb in zip(chunks, scores, embeddings):
            cid = insert_chunk(
                content=chunk_text,
                source_file=upload.filename or "upload",
                complexity_score=score,
                user_id=user_id,
            )
            chunk_ids.append(cid)

        metadatas = [
            {"user_id": user_id, "chunk_id": cid, "source_file": upload.filename or "upload"}
            for cid in chunk_ids
        ]
        add_chunks(chunk_ids, embeddings, metadatas)

        for cid, chunk_text in zip(chunk_ids, chunks):
            background_tasks.add_task(classify_and_store, cid, chunk_text)

        total_chunks += len(chunk_ids)
        last_source = upload.filename or "upload"

    return IngestResponse(chunks_created=total_chunks, source=last_source)


@router.post("/ingest/text", response_model=TextIngestResponse)
async def ingest_text(
    body: TextIngestRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """JSON ingest endpoint — matches frontend POST /api/ingest with text content."""
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty.")

    chunks = chunker.chunk_text(body.content)
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not extract any chunks from content.")

    scores = [complexity.score(c) for c in chunks]
    embeddings = embed_texts(chunks)
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
    add_chunks(chunk_ids, embeddings, metadatas)

    for cid, chunk_text in zip(chunk_ids, chunks):
        background_tasks.add_task(classify_and_store, cid, chunk_text)

    first_score = scores[0] if scores else 0.5
    S = round((1.0 + 0.5 * math.log1p(0)) * 9.0, 2)
    k = round(0.5 + 1.5 * max(0.0, min(1.0, first_score)), 3)

    return TextIngestResponse(
        chunk_id=chunk_ids[0],
        category="general",
        stability_S=S,
        complexity_k=k,
        message=f"Ingested {len(chunk_ids)} chunk(s). Category classification running in background.",
    )
