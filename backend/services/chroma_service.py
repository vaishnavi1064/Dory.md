"""
ChromaDB singleton.

Collection: dory_chunks
  - Embeddings: all-MiniLM-L6-v2 (384-dim)
  - Metadata per document: user_id, chunk_id, source_file
  - Persisted at ./data/chroma
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings

_client: Optional[chromadb.ClientAPI] = None
_collection = None
COLLECTION_NAME = "dory_chunks"
CHROMA_PATH = Path(__file__).parent.parent / "data" / "chroma"


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        CHROMA_PATH.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(
            path=str(CHROMA_PATH),
            settings=Settings(anonymized_telemetry=False),
        )
    return _client


def get_collection():
    global _collection
    if _collection is None:
        _collection = _get_client().get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def add_chunks(chunk_ids: list[str], embeddings: list[list[float]], metadatas: list[dict]) -> None:
    """Store embeddings + metadata. Documents are not stored (content lives in SQLite)."""
    col = get_collection()
    col.add(ids=chunk_ids, embeddings=embeddings, metadatas=metadatas)


def query_similar(
    query_embedding: list[float],
    user_id: str,
    n_results: int = 50,
) -> dict:
    """
    Return the top-n most similar chunks for a user.
    ChromaDB returns distances (lower = more similar for cosine space).
    We convert distance → similarity: similarity = 1 - distance.
    """
    col = get_collection()
    results = col.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, col.count()),
        where={"user_id": user_id},
        include=["distances", "metadatas"],
    )
    ids = results["ids"][0]
    distances = results["distances"][0]
    metadatas = results["metadatas"][0]
    similarities = [1.0 - d for d in distances]
    return {"ids": ids, "similarities": similarities, "metadatas": metadatas}


def delete_chunk(chunk_id: str, user_id: str) -> None:
    """Delete only if the embedding's metadata user_id matches. Silent no-op otherwise."""
    get_collection().delete(ids=[chunk_id], where={"user_id": user_id})


def count() -> int:
    return get_collection().count()
