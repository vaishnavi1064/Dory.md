"""
Notion integration router.

Auth modes (auto-detected from env vars):
  OAuth  — NOTION_CLIENT_ID + NOTION_CLIENT_SECRET set → full OAuth2 flow
            GET  /auth/notion           → redirect to Notion consent
            GET  /auth/notion/callback  → exchange code, store token
  Internal — fallback; user pastes their own token in the frontend
             Token stored in oauth_tokens table the same way

All API endpoints work with whichever token is stored:
  GET  /api/notion/status        → connection info + oauth availability
  GET  /api/notion/pages         → list accessible pages
  POST /api/notion/import        → import selected pages into Dory
  POST /api/notion/create        → write a new page to Notion
  DELETE /auth/notion            → revoke / disconnect
"""

import base64
import os
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from notion_client import Client as NotionClient
from pydantic import BaseModel

from core import chunker, complexity
from core.embeddings import embed_texts
from database.db import (
    DEFAULT_USER_ID,
    delete_oauth_token,
    get_oauth_token,
    insert_chunk,
    store_oauth_token,
)
from models.schemas import NotionImportRequest, NotionImportResponse, NotionPage
from parsers.markdown_to_notion import markdown_to_notion_blocks
from parsers.notion_blocks import blocks_to_markdown
from routers.deps import get_current_user_id
from services.category_service import classify_and_store
from services.chroma_service import add_chunks

router = APIRouter()

_CLIENT_ID     = os.getenv("NOTION_CLIENT_ID", "")
_CLIENT_SECRET = os.getenv("NOTION_CLIENT_SECRET", "")
_REDIRECT_URI  = os.getenv("NOTION_REDIRECT_URI", "http://localhost:8000/auth/notion/callback")
_FRONTEND_URL  = os.getenv("FRONTEND_URL", "http://localhost:5173")
OAUTH_AVAILABLE = bool(_CLIENT_ID and _CLIENT_SECRET)


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _ingest_markdown(text: str, source_name: str, background_tasks: BackgroundTasks, user_id: str) -> int:
    chunks = chunker.chunk_text(text)
    if not chunks:
        return 0
    scores = [complexity.score(c) for c in chunks]
    embeddings = embed_texts(chunks)
    chunk_ids = []
    for c, s in zip(chunks, scores):
        cid = insert_chunk(content=c, source_file=source_name, complexity_score=s, user_id=user_id)
        chunk_ids.append(cid)
    metadatas = [{"user_id": user_id, "chunk_id": cid, "source_file": source_name} for cid in chunk_ids]
    add_chunks(chunk_ids, embeddings, metadatas)
    for cid, c in zip(chunk_ids, chunks):
        background_tasks.add_task(classify_and_store, cid, c)
    return len(chunk_ids)


def _fetch_page_blocks(notion: NotionClient, page_id: str) -> list[dict]:
    results, cursor = [], None
    while True:
        kwargs: dict = {"block_id": page_id}
        if cursor:
            kwargs["start_cursor"] = cursor
        resp = notion.blocks.children.list(**kwargs)
        results.extend(resp.get("results", []))
        if not resp.get("has_more"):
            break
        cursor = resp.get("next_cursor")
    return results


def _page_title(page: dict) -> str:
    props = page.get("properties", {})
    for key in ("title", "Name", "Title"):
        if key in props:
            rt = props[key].get("title", [])
            return "".join(t.get("plain_text", "") for t in rt) or page["id"]
    return page["id"]


def _get_token(user_id: str) -> str | None:
    return get_oauth_token(user_id)


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get("/api/notion/status")
def notion_status(user_id: str = Depends(get_current_user_id)):
    """Return connection state and whether OAuth is configured."""
    token = _get_token(user_id)
    if not token:
        return {"connected": False, "oauth_available": OAUTH_AVAILABLE}
    try:
        notion = NotionClient(auth=token)
        user = notion.users.me()
        workspace = user.get("name") or "Notion Workspace"
        avatar = user.get("avatar_url")
        return {
            "connected": True,
            "oauth_available": OAUTH_AVAILABLE,
            "workspace": workspace,
            "avatar": avatar,
        }
    except Exception:
        delete_oauth_token(user_id)
        return {"connected": False, "oauth_available": OAUTH_AVAILABLE}


# ── OAuth flow ─────────────────────────────────────────────────────────────────

@router.get("/auth/notion")
def notion_auth_start():
    if not OAUTH_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail=(
                "Notion OAuth is not configured. "
                "Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in .env "
                "and restart the server."
            ),
        )
    url = (
        "https://api.notion.com/v1/oauth/authorize"
        f"?client_id={_CLIENT_ID}"
        "&response_type=code"
        "&owner=user"
        f"&redirect_uri={_REDIRECT_URI}"
    )
    return RedirectResponse(url)


@router.get("/auth/notion/callback")
async def notion_auth_callback(request: Request):
    code = request.query_params.get("code")
    error = request.query_params.get("error")

    if error or not code:
        return RedirectResponse(f"{_FRONTEND_URL}/notion?error={error or 'missing_code'}")

    credentials = base64.b64encode(f"{_CLIENT_ID}:{_CLIENT_SECRET}".encode()).decode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.notion.com/v1/oauth/token",
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/json",
            },
            json={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _REDIRECT_URI,
            },
        )
        data = resp.json()

    if "access_token" not in data:
        return RedirectResponse(f"{_FRONTEND_URL}/notion?error=token_exchange_failed")

    # OAuth callback has no JWT — store under DEFAULT_USER_ID as a shared workspace token
    store_oauth_token(
        user_id=DEFAULT_USER_ID,
        access_token=data["access_token"],
        workspace_id=data.get("workspace_id", ""),
        bot_id=data.get("bot_id", ""),
    )
    return RedirectResponse(f"{_FRONTEND_URL}/notion?connected=true")


@router.delete("/auth/notion")
def revoke_notion(user_id: str = Depends(get_current_user_id)):
    delete_oauth_token(user_id)
    return {"message": "Notion disconnected."}


# ── Internal token connect (fallback when OAuth not configured) ────────────────

class TokenConnectRequest(BaseModel):
    token: str


@router.post("/api/notion/connect")
def connect_with_token(body: TokenConnectRequest, user_id: str = Depends(get_current_user_id)):
    """Store an internal integration token (no OAuth needed)."""
    try:
        notion = NotionClient(auth=body.token)
        user = notion.users.me()
        workspace = user.get("name") or "Notion Workspace"
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    store_oauth_token(
        user_id=user_id,
        access_token=body.token,
        workspace_id="",
        bot_id="",
    )
    return {"connected": True, "workspace": workspace}


# ── Pages ──────────────────────────────────────────────────────────────────────

@router.get("/api/notion/pages", response_model=list[NotionPage])
def list_notion_pages(user_id: str = Depends(get_current_user_id)):
    token = _get_token(user_id)
    if not token:
        raise HTTPException(status_code=401, detail="Not connected to Notion.")
    notion = NotionClient(auth=token)
    resp = notion.search(filter={"property": "object", "value": "page"}, page_size=50)
    return [NotionPage(id=p["id"], title=_page_title(p)) for p in resp.get("results", [])]


# ── Import pages into Dory ─────────────────────────────────────────────────────

@router.post("/api/notion/import", response_model=NotionImportResponse)
async def import_notion_pages(
    body: NotionImportRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    token = body.token or _get_token(user_id)
    if not token:
        raise HTTPException(status_code=401, detail="Not connected to Notion.")

    notion = NotionClient(auth=token)
    total_pages = total_chunks = 0

    for page_id in body.page_ids:
        try:
            page = notion.pages.retrieve(page_id=page_id)
            title = _page_title(page)
            blocks = _fetch_page_blocks(notion, page_id)
            markdown = blocks_to_markdown(blocks)
            if markdown.strip():
                total_chunks += _ingest_markdown(markdown, f"Notion: {title}", background_tasks, user_id)
            total_pages += 1
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch page {page_id}: {e}")

    return NotionImportResponse(pages_imported=total_pages, chunks_created=total_chunks)


# ── Create / write a page to Notion ───────────────────────────────────────────

class NotionCreateRequest(BaseModel):
    title: str
    content: str
    parent_id: str
    token: Optional[str] = None


@router.post("/api/notion/create")
async def create_notion_page(
    body: NotionCreateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    token = body.token or _get_token(user_id)
    if not token:
        raise HTTPException(status_code=401, detail="Not connected to Notion.")

    notion = NotionClient(auth=token)
    blocks = markdown_to_notion_blocks(body.content)

    try:
        page = notion.pages.create(
            parent={"page_id": body.parent_id.replace("-", "")},
            properties={"title": [{"type": "text", "text": {"content": body.title}}]},
            children=blocks[:100],
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Notion API error: {e}")

    n = _ingest_markdown(body.content, f"Notion: {body.title}", background_tasks, user_id)
    return {
        "page_id": page["id"],
        "url": page.get("url", ""),
        "title": body.title,
        "chunks_indexed": n,
    }
