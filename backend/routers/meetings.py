"""Manual meeting calendar — CRUD for user-entered meetings."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database.db import (
    delete_meeting as db_delete_meeting,
    get_meeting,
    insert_meeting,
    list_meetings,
    update_meeting as db_update_meeting,
)
from models.schemas import (
    CreateMeetingRequest,
    MeetingListResponse,
    MeetingOut,
    UpdateMeetingRequest,
)
from ratelimit import rate_limit
from routers.deps import get_current_user_id

router = APIRouter()

_TITLE_MAX = 200
_LINK_MAX = 500
_NOTES_MAX = 1000
_LOCATION_MAX = 500
_DURATION_MIN = 1
_DURATION_MAX = 1440


def _normalize_link(raw: Optional[str]) -> Optional[str]:
    """Normalize and validate a meeting link.

    - None or empty/whitespace → None
    - http:// or https:// → return as-is (after trim)
    - Bare hostname (e.g. zoom.us/j/123) → prepend https://
    - Other schemes (javascript:, ftp:, data:, etc.) → HTTP 400
    """
    if raw is None:
        return None
    link = raw.strip()
    if not link:
        return None

    lower = link.lower()
    if lower.startswith("http://") or lower.startswith("https://"):
        if len(link) > _LINK_MAX:
            raise HTTPException(status_code=400, detail="Link too long.")
        return link

    if "://" in link or lower.startswith((
        "javascript:", "data:", "file:", "ftp:", "ftps:",
        "mailto:", "tel:", "vbscript:",
    )):
        raise HTTPException(status_code=400, detail="Link must use http:// or https://")

    if "." not in link:
        raise HTTPException(status_code=400, detail="Link does not look like a URL")

    normalized = f"https://{link}"
    if len(normalized) > _LINK_MAX:
        raise HTTPException(status_code=400, detail="Link too long.")
    return normalized


def _parse_starts_at(raw: str) -> str:
    s = raw.strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid starts_at.") from exc
    if dt.tzinfo is None:
        raise HTTPException(status_code=400, detail="starts_at must include timezone.")
    return dt.astimezone(timezone.utc).isoformat()


def _parse_range_param(raw: Optional[str], field: str) -> Optional[str]:
    if raw is None:
        return None
    return _parse_starts_at(raw)


def _validate_title(title: str) -> str:
    trimmed = title.strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="Title is required.")
    if len(trimmed) > _TITLE_MAX:
        raise HTTPException(status_code=400, detail="Title too long.")
    return trimmed


def _validate_duration(duration: int) -> int:
    if duration < _DURATION_MIN or duration > _DURATION_MAX:
        raise HTTPException(status_code=400, detail="Invalid duration_minutes.")
    return duration


def _validate_notes(notes: Optional[str]) -> Optional[str]:
    if notes is None:
        return None
    trimmed = notes.strip()
    if not trimmed:
        return None
    if len(trimmed) > _NOTES_MAX:
        raise HTTPException(status_code=400, detail="Notes too long.")
    return trimmed


def _validate_location(location: Optional[str]) -> Optional[str]:
    if location is None:
        return None
    trimmed = location.strip()
    if not trimmed:
        return None
    if len(trimmed) > _LOCATION_MAX:
        raise HTTPException(status_code=400, detail="Location too long.")
    return trimmed


def _to_out(data: dict) -> MeetingOut:
    return MeetingOut(**data)


@router.post(
    "/meetings",
    response_model=MeetingOut,
    status_code=201,
    dependencies=[Depends(rate_limit("meetings", limit=30))],
)
def create_meeting(body: CreateMeetingRequest, user_id: str = Depends(get_current_user_id)):
    title = _validate_title(body.title)
    starts_at = _parse_starts_at(body.starts_at)
    duration = _validate_duration(body.duration_minutes)
    link = _normalize_link(body.link)
    notes = _validate_notes(body.notes)
    location = _validate_location(body.location)

    row = insert_meeting(
        user_id,
        title=title,
        starts_at=starts_at,
        duration_minutes=duration,
        link=link,
        notes=notes,
        location=location,
    )
    return _to_out(row)


@router.get("/meetings", response_model=MeetingListResponse)
def get_meetings(
    user_id: str = Depends(get_current_user_id),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    now = datetime.now(timezone.utc)
    from_iso = _parse_range_param(from_, "from") or (now - timedelta(hours=1)).isoformat()
    to_iso = _parse_range_param(to, "to") or (now + timedelta(days=90)).isoformat()

    rows = list_meetings(user_id, from_iso=from_iso, to_iso=to_iso, limit=limit)
    return MeetingListResponse(meetings=[_to_out(r) for r in rows])


@router.get("/meetings/{meeting_id}", response_model=MeetingOut)
def get_meeting_by_id(meeting_id: str, user_id: str = Depends(get_current_user_id)):
    row = get_meeting(meeting_id, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return _to_out(row)


@router.patch("/meetings/{meeting_id}", response_model=MeetingOut)
def patch_meeting(
    meeting_id: str,
    body: UpdateMeetingRequest,
    user_id: str = Depends(get_current_user_id),
):
    if get_meeting(meeting_id, user_id) is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    kwargs: dict = {}

    if body.title is not None:
        kwargs["title"] = _validate_title(body.title)
    if body.starts_at is not None:
        kwargs["starts_at"] = _parse_starts_at(body.starts_at)
    if body.duration_minutes is not None:
        kwargs["duration_minutes"] = _validate_duration(body.duration_minutes)
    if body.link is not None:
        normalized = _normalize_link(body.link)
        if normalized is None:
            kwargs["clear_link"] = True
        else:
            kwargs["link"] = normalized
    if body.notes is not None:
        normalized = _validate_notes(body.notes)
        if normalized is None:
            kwargs["clear_notes"] = True
        else:
            kwargs["notes"] = normalized
    if body.location is not None:
        normalized = _validate_location(body.location)
        if normalized is None:
            kwargs["clear_location"] = True
        else:
            kwargs["location"] = normalized

    row = db_update_meeting(meeting_id, user_id, **kwargs)
    if row is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return _to_out(row)


@router.delete("/meetings/{meeting_id}", status_code=204)
def remove_meeting(meeting_id: str, user_id: str = Depends(get_current_user_id)):
    if not db_delete_meeting(meeting_id, user_id):
        raise HTTPException(status_code=404, detail="Meeting not found.")
