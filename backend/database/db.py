import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

DEFAULT_USER_ID = "default"


def _db_path() -> Path:
    """Resolve the SQLite path. Tests set DORY_DB_PATH to a temp file."""
    override = os.getenv("DORY_DB_PATH")
    if override:
        return Path(override)
    return Path(__file__).parent.parent / "data" / "dory.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    chunk_cols = {row[1] for row in conn.execute("PRAGMA table_info(chunks)").fetchall()}
    if "folder" not in chunk_cols:
        conn.execute("ALTER TABLE chunks ADD COLUMN folder TEXT DEFAULT NULL")

    # FSRS spaced-repetition state. New chunks default to a fresh card with
    # due_date = creation time so they appear in the review queue immediately.
    if "fsrs_due" not in chunk_cols:
        conn.execute("ALTER TABLE chunks ADD COLUMN fsrs_due TEXT")
        conn.execute("ALTER TABLE chunks ADD COLUMN fsrs_state INTEGER DEFAULT 1")  # 1 = Learning
        conn.execute("ALTER TABLE chunks ADD COLUMN fsrs_step INTEGER DEFAULT 0")
        conn.execute("ALTER TABLE chunks ADD COLUMN fsrs_stability REAL")
        conn.execute("ALTER TABLE chunks ADD COLUMN fsrs_difficulty REAL")
        conn.execute("ALTER TABLE chunks ADD COLUMN fsrs_last_review TEXT")
        # Backfill existing chunks so they're immediately reviewable.
        conn.execute(
            "UPDATE chunks SET fsrs_due = COALESCE(last_accessed, created_at, ?) WHERE fsrs_due IS NULL",
            (datetime.now(timezone.utc).isoformat(),),
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_chunks_fsrs_due ON chunks(user_id, fsrs_due)"
        )

    user_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "name" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN name TEXT")
    if "password_hash" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")

    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "meetings" not in tables:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                starts_at DATETIME NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 30,
                link TEXT,
                notes TEXT,
                location TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS idx_meetings_user_starts
                ON meetings(user_id, starts_at);
        """)

    if "chunk_state_log" in tables:
        chunk_log_cols = {
            row[1]: row[3]
            for row in conn.execute("PRAGMA table_info(chunk_state_log)").fetchall()
        }
        if chunk_log_cols.get("chunk_id") == 1:
            conn.executescript("""
                CREATE TABLE chunk_state_log_migrate (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_id TEXT,
                    user_id TEXT NOT NULL,
                    mood TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE SET NULL
                );
                INSERT INTO chunk_state_log_migrate
                    (id, chunk_id, user_id, mood, event_type, logged_at)
                SELECT id, chunk_id, user_id, mood, event_type, logged_at
                FROM chunk_state_log;
                DROP TABLE chunk_state_log;
                ALTER TABLE chunk_state_log_migrate RENAME TO chunk_state_log;
                CREATE INDEX IF NOT EXISTS idx_chunk_state_log_user_time
                    ON chunk_state_log(user_id, logged_at);
                CREATE INDEX IF NOT EXISTS idx_chunk_state_log_chunk
                    ON chunk_state_log(chunk_id);
            """)

    conn.commit()


def init_db() -> None:
    conn = _connect()
    conn.executescript(SCHEMA_PATH.read_text())
    _migrate(conn)
    # Ensure the default demo user exists
    conn.execute(
        "INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)",
        (DEFAULT_USER_ID, "demo@dory.md", "Demo User"),
    )
    conn.commit()
    conn.close()


def get_connection() -> sqlite3.Connection:
    return _connect()


# ---------------------------------------------------------------------------
# User / auth helpers
# ---------------------------------------------------------------------------

def get_user_by_email(email: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return row


def get_user_by_id(user_id: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row


def create_user(email: str, name: str, password_hash: str) -> str:
    user_id = str(uuid.uuid4())
    conn = _connect()
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
        (user_id, email, name, password_hash),
    )
    conn.commit()
    conn.close()
    return user_id


def set_user_password_hash(user_id: str, password_hash: str) -> None:
    conn = _connect()
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Chunk helpers
# ---------------------------------------------------------------------------

def insert_chunk(
    content: str,
    source_file: str,
    complexity_score: float,
    user_id: str = DEFAULT_USER_ID,
    created_at: Optional[datetime] = None,
    last_accessed: Optional[datetime] = None,
    access_count: int = 0,
) -> str:
    chunk_id = str(uuid.uuid4())
    created_iso = (created_at or datetime.now(timezone.utc)).isoformat()
    last_accessed_iso = (last_accessed or datetime.now(timezone.utc)).isoformat()
    # New chunks become due for review immediately — this is the FSRS-fresh state.
    fsrs_due_iso = created_iso
    conn = _connect()
    conn.execute(
        """INSERT INTO chunks
           (id, user_id, source_file, content, complexity_score,
            created_at, last_accessed, access_count, fsrs_due, fsrs_state, fsrs_step)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            chunk_id,
            user_id,
            source_file,
            content,
            complexity_score,
            created_iso,
            last_accessed_iso,
            access_count,
            fsrs_due_iso,
            1,  # Learning state
            0,  # step 0
        ),
    )
    conn.commit()
    conn.close()
    return chunk_id


def get_chunk(chunk_id: str, user_id: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM chunks WHERE id = ? AND user_id = ?",
        (chunk_id, user_id),
    ).fetchone()
    conn.close()
    return row


def get_all_chunks(user_id: str = DEFAULT_USER_ID) -> list[sqlite3.Row]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM chunks WHERE user_id = ?", (user_id,)
    ).fetchall()
    conn.close()
    return rows


def get_stale_chunk_candidates(user_id: str = DEFAULT_USER_ID, limit: int = 50) -> list[sqlite3.Row]:
    """Return a CANDIDATE POOL of chunks likely to have low retention, cheaply
    pre-filtered in SQL by oldest last_accessed + lowest access_count.

    This is NOT the final answer: it does not compute the true Ebbinghaus retention
    (which also depends on complexity_score). Callers that need the genuinely
    lowest-retention chunks (e.g. the quiz) should re-rank this pool with
    intelligence.memory.calculate_retention. Keeping the retention math out of the
    persistence layer preserves the backend/intelligence boundary.
    """
    conn = _connect()
    rows = conn.execute(
        """SELECT * FROM chunks WHERE user_id = ?
           ORDER BY last_accessed ASC, access_count ASC
           LIMIT ?""",
        (user_id, limit),
    ).fetchall()
    conn.close()
    return rows


def get_review_queue(user_id: str, limit: int = 20, now_iso: Optional[str] = None) -> list[sqlite3.Row]:
    """Return chunks whose FSRS due-date is at or before `now`, oldest-due first.
    These are the cards the user should review right now."""
    now_iso = now_iso or datetime.now(timezone.utc).isoformat()
    conn = _connect()
    rows = conn.execute(
        """SELECT * FROM chunks
           WHERE user_id = ? AND fsrs_due IS NOT NULL AND fsrs_due <= ?
           ORDER BY fsrs_due ASC
           LIMIT ?""",
        (user_id, now_iso, limit),
    ).fetchall()
    conn.close()
    return rows


def count_due_chunks(user_id: str, now_iso: Optional[str] = None) -> int:
    """Total number of chunks currently due for review for this user."""
    now_iso = now_iso or datetime.now(timezone.utc).isoformat()
    conn = _connect()
    row = conn.execute(
        "SELECT COUNT(*) FROM chunks WHERE user_id = ? AND fsrs_due IS NOT NULL AND fsrs_due <= ?",
        (user_id, now_iso),
    ).fetchone()
    conn.close()
    return row[0]


def apply_fsrs_update(chunk_id: str, user_id: str, fsrs: dict) -> bool:
    """Persist the FSRS state returned by the scheduler. Returns True if the
    chunk exists and belongs to the user."""
    conn = _connect()
    cursor = conn.execute(
        """UPDATE chunks
           SET fsrs_state = ?,
               fsrs_step = ?,
               fsrs_stability = ?,
               fsrs_difficulty = ?,
               fsrs_due = ?,
               fsrs_last_review = ?,
               last_accessed = ?,
               access_count = access_count + 1
           WHERE id = ? AND user_id = ?""",
        (
            fsrs["fsrs_state"],
            fsrs["fsrs_step"],
            fsrs["fsrs_stability"],
            fsrs["fsrs_difficulty"],
            fsrs["fsrs_due"],
            fsrs["fsrs_last_review"],
            datetime.now(timezone.utc).isoformat(),
            chunk_id,
            user_id,
        ),
    )
    updated = cursor.rowcount > 0
    if updated:
        conn.execute(
            "INSERT INTO access_log (chunk_id, user_id, accessed_at, source) VALUES (?, ?, ?, ?)",
            (chunk_id, user_id, datetime.now(timezone.utc).isoformat(), "review"),
        )
    conn.commit()
    conn.close()
    return updated


def update_chunk_access(chunk_id: str, user_id: str, source: str = "manual") -> Optional[sqlite3.Row]:
    conn = _connect()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "UPDATE chunks SET access_count = access_count + 1, last_accessed = ? WHERE id = ? AND user_id = ?",
        (now, chunk_id, user_id),
    )
    if cursor.rowcount == 0:
        conn.close()
        return None
    conn.execute(
        "INSERT INTO access_log (chunk_id, user_id, accessed_at, source) VALUES (?, ?, ?, ?)",
        (chunk_id, user_id, now, source),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM chunks WHERE id = ? AND user_id = ?",
        (chunk_id, user_id),
    ).fetchone()
    conn.close()
    return row


def update_chunk_access_by(chunk_id: str, delta: int, user_id: str, source: str = "quiz") -> Optional[sqlite3.Row]:
    """Increment access_count by an arbitrary delta (used by quiz correct answers)."""
    conn = _connect()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "UPDATE chunks SET access_count = access_count + ?, last_accessed = ? WHERE id = ? AND user_id = ?",
        (delta, now, chunk_id, user_id),
    )
    if cursor.rowcount == 0:
        conn.close()
        return None
    conn.execute(
        "INSERT INTO access_log (chunk_id, user_id, accessed_at, source) VALUES (?, ?, ?, ?)",
        (chunk_id, user_id, now, source),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM chunks WHERE id = ? AND user_id = ?",
        (chunk_id, user_id),
    ).fetchone()
    conn.close()
    return row


def update_chunk_category(chunk_id: str, category: str) -> None:
    """Server-internal: called by background classifier. No user_id check by design."""
    conn = _connect()
    conn.execute("UPDATE chunks SET category = ? WHERE id = ?", (category, chunk_id))
    conn.commit()
    conn.close()


def delete_chunk(chunk_id: str, user_id: str) -> bool:
    """Delete a chunk only if it belongs to user_id. Returns True if a row was deleted."""
    conn = _connect()
    cursor = conn.execute(
        "DELETE FROM chunks WHERE id = ? AND user_id = ?",
        (chunk_id, user_id),
    )
    deleted = cursor.rowcount > 0
    if deleted:
        conn.execute("DELETE FROM access_log WHERE chunk_id = ?", (chunk_id,))
    conn.commit()
    conn.close()
    return deleted


def update_chunk_content(chunk_id: str, content: str, user_id: str) -> bool:
    conn = _connect()
    cursor = conn.execute(
        "UPDATE chunks SET content = ? WHERE id = ? AND user_id = ?",
        (content, chunk_id, user_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated


def set_chunk_folder(chunk_id: str, folder: Optional[str], user_id: str) -> bool:
    conn = _connect()
    cursor = conn.execute(
        "UPDATE chunks SET folder = ? WHERE id = ? AND user_id = ?",
        (folder, chunk_id, user_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated


def get_folders(user_id: str = DEFAULT_USER_ID) -> list[str]:
    conn = _connect()
    rows = conn.execute(
        "SELECT DISTINCT folder FROM chunks WHERE user_id = ? AND folder IS NOT NULL AND folder != '' ORDER BY folder",
        (user_id,),
    ).fetchall()
    conn.close()
    return [row["folder"] for row in rows]


def get_chunk_full(chunk_id: str, user_id: str) -> Optional[sqlite3.Row]:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM chunks WHERE id = ? AND user_id = ?",
        (chunk_id, user_id),
    ).fetchone()
    conn.close()
    return row


def count_chunks(user_id: str = DEFAULT_USER_ID) -> int:
    conn = _connect()
    count = conn.execute(
        "SELECT COUNT(*) FROM chunks WHERE user_id = ?", (user_id,)
    ).fetchone()[0]
    conn.close()
    return count


# ---------------------------------------------------------------------------
# Quiz session helpers
# ---------------------------------------------------------------------------

def create_quiz_session(user_id: str = DEFAULT_USER_ID, total: int = 5) -> str:
    session_id = str(uuid.uuid4())
    conn = _connect()
    conn.execute(
        "INSERT INTO quiz_sessions (id, user_id, total_count) VALUES (?, ?, ?)",
        (session_id, user_id, total),
    )
    conn.commit()
    conn.close()
    return session_id


def complete_quiz_session(session_id: str, correct_count: int, user_id: Optional[str] = None) -> bool:
    """Mark a quiz session finished. Scoped to user_id when provided so one user
    cannot complete another user's session. Returns True if a row was updated."""
    conn = _connect()
    if user_id is None:
        cursor = conn.execute(
            "UPDATE quiz_sessions SET completed_at = ?, correct_count = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), correct_count, session_id),
        )
    else:
        cursor = conn.execute(
            "UPDATE quiz_sessions SET completed_at = ?, correct_count = ? WHERE id = ? AND user_id = ?",
            (datetime.now(timezone.utc).isoformat(), correct_count, session_id, user_id),
        )
    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated


def get_quiz_history(user_id: str, limit: int = 20) -> list[sqlite3.Row]:
    """Return the user's completed quiz sessions, most recent first."""
    conn = _connect()
    rows = conn.execute(
        """SELECT id, started_at, completed_at, correct_count, total_count
           FROM quiz_sessions
           WHERE user_id = ? AND completed_at IS NOT NULL
           ORDER BY completed_at DESC
           LIMIT ?""",
        (user_id, limit),
    ).fetchall()
    conn.close()
    return rows


# ---------------------------------------------------------------------------
# Refresh token helpers
# ---------------------------------------------------------------------------

def store_refresh_token(token_hash: str, user_id: str, expires_at: datetime) -> None:
    conn = _connect()
    conn.execute(
        """INSERT INTO refresh_tokens (token_hash, user_id, expires_at)
           VALUES (?, ?, ?)""",
        (token_hash, user_id, expires_at.isoformat()),
    )
    conn.commit()
    conn.close()


def get_active_refresh_token(token_hash: str) -> Optional[sqlite3.Row]:
    """Return the row only if not revoked and not expired."""
    conn = _connect()
    row = conn.execute(
        """SELECT * FROM refresh_tokens
           WHERE token_hash = ?
             AND revoked_at IS NULL
             AND expires_at > ?""",
        (token_hash, datetime.now(timezone.utc).isoformat()),
    ).fetchone()
    conn.close()
    return row


def revoke_refresh_token(token_hash: str) -> None:
    conn = _connect()
    conn.execute(
        "UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        (datetime.now(timezone.utc).isoformat(), token_hash),
    )
    conn.commit()
    conn.close()


def purge_expired_refresh_tokens() -> None:
    conn = _connect()
    conn.execute(
        "DELETE FROM refresh_tokens WHERE expires_at <= ?",
        (datetime.now(timezone.utc).isoformat(),),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Account deletion / export (GDPR)
# ---------------------------------------------------------------------------

def get_access_log(user_id: str) -> list[sqlite3.Row]:
    """All access-log rows for a user, oldest first (used by the data export)."""
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM access_log WHERE user_id = ? ORDER BY accessed_at",
        (user_id,),
    ).fetchall()
    conn.close()
    return rows


def delete_user_data(user_id: str) -> bool:
    """Hard-delete EVERYTHING belonging to a user in a single transaction (GDPR
    right-to-erasure — no soft delete, no grace period). Child rows are removed
    before the parent `users` row because the FKs have no ON DELETE CASCADE.
    Returns True if the user existed and was deleted, False if there was no such user.
    """
    conn = _connect()
    try:
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            return False

        # Forward-compat: the upcoming mood-tagging table. No-op until it exists,
        # so this same code works before AND after that migration lands.
        try:
            conn.execute("DELETE FROM chunk_state_log WHERE user_id = ?", (user_id,))
        except sqlite3.OperationalError:
            pass

        conn.execute("DELETE FROM access_log WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM quiz_sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM refresh_tokens WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM chunks WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM meetings WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Mood state log (Phase 1 — collection only, no curve changes)
# ---------------------------------------------------------------------------

def insert_chunk_state_log(
    chunk_id: Optional[str],
    user_id: str,
    mood: str,
    event_type: str,
) -> int:
    conn = _connect()
    cur = conn.execute(
        """INSERT INTO chunk_state_log (chunk_id, user_id, mood, event_type)
           VALUES (?, ?, ?, ?)""",
        (chunk_id, user_id, mood, event_type),
    )
    row_id = cur.lastrowid
    conn.commit()
    conn.close()
    return int(row_id)


def get_mood_logs(
    user_id: str,
    *,
    days: int = 30,
    limit: int = 10_000,
) -> list[sqlite3.Row]:
    conn = _connect()
    rows = conn.execute(
        """SELECT id, chunk_id, mood, event_type, logged_at
           FROM chunk_state_log
           WHERE user_id = ?
             AND logged_at >= datetime('now', ?)
           ORDER BY logged_at DESC
           LIMIT ?""",
        (user_id, f"-{days} days", limit),
    ).fetchall()
    conn.close()
    return rows


def count_mood_logs(user_id: str) -> int:
    conn = _connect()
    n = conn.execute(
        "SELECT COUNT(*) FROM chunk_state_log WHERE user_id = ?",
        (user_id,),
    ).fetchone()[0]
    conn.close()
    return int(n)


# ---------------------------------------------------------------------------
# Meetings (manual calendar — user-entered, notification reminders)
# ---------------------------------------------------------------------------

def _row_to_meeting(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "starts_at": row["starts_at"],
        "duration_minutes": row["duration_minutes"],
        "link": row["link"],
        "notes": row["notes"],
        "location": row["location"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def insert_meeting(
    user_id: str,
    *,
    title: str,
    starts_at: str,
    duration_minutes: int,
    link: Optional[str] = None,
    notes: Optional[str] = None,
    location: Optional[str] = None,
) -> dict:
    meeting_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    conn.execute(
        """INSERT INTO meetings
           (id, user_id, title, starts_at, duration_minutes, link, notes, location,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            meeting_id, user_id, title, starts_at, duration_minutes,
            link, notes, location, now, now,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
    conn.close()
    return _row_to_meeting(row)


def get_meeting(meeting_id: str, user_id: str) -> Optional[dict]:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM meetings WHERE id = ? AND user_id = ?",
        (meeting_id, user_id),
    ).fetchone()
    conn.close()
    return _row_to_meeting(row) if row else None


def list_meetings(
    user_id: str,
    *,
    from_iso: str,
    to_iso: str,
    limit: int = 100,
) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        """SELECT * FROM meetings
           WHERE user_id = ?
             AND starts_at >= ?
             AND starts_at <= ?
           ORDER BY starts_at ASC
           LIMIT ?""",
        (user_id, from_iso, to_iso, limit),
    ).fetchall()
    conn.close()
    return [_row_to_meeting(r) for r in rows]


def update_meeting(
    meeting_id: str,
    user_id: str,
    *,
    title: Optional[str] = None,
    starts_at: Optional[str] = None,
    duration_minutes: Optional[int] = None,
    link: Optional[str] = None,
    notes: Optional[str] = None,
    location: Optional[str] = None,
    clear_link: bool = False,
    clear_notes: bool = False,
    clear_location: bool = False,
) -> Optional[dict]:
    existing = get_meeting(meeting_id, user_id)
    if existing is None:
        return None

    fields: list[str] = []
    values: list = []

    if title is not None:
        fields.append("title = ?")
        values.append(title)
    if starts_at is not None:
        fields.append("starts_at = ?")
        values.append(starts_at)
    if duration_minutes is not None:
        fields.append("duration_minutes = ?")
        values.append(duration_minutes)
    if link is not None:
        fields.append("link = ?")
        values.append(link)
    elif clear_link:
        fields.append("link = ?")
        values.append(None)
    if notes is not None:
        fields.append("notes = ?")
        values.append(notes)
    elif clear_notes:
        fields.append("notes = ?")
        values.append(None)
    if location is not None:
        fields.append("location = ?")
        values.append(location)
    elif clear_location:
        fields.append("location = ?")
        values.append(None)

    if not fields:
        return existing

    now = datetime.now(timezone.utc).isoformat()
    fields.append("updated_at = ?")
    values.append(now)
    values.extend([meeting_id, user_id])

    conn = _connect()
    conn.execute(
        f"UPDATE meetings SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
        values,
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM meetings WHERE id = ? AND user_id = ?",
        (meeting_id, user_id),
    ).fetchone()
    conn.close()
    return _row_to_meeting(row) if row else None


def delete_meeting(meeting_id: str, user_id: str) -> bool:
    conn = _connect()
    cur = conn.execute(
        "DELETE FROM meetings WHERE id = ? AND user_id = ?",
        (meeting_id, user_id),
    )
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted


def count_meetings(user_id: str) -> int:
    conn = _connect()
    n = conn.execute(
        "SELECT COUNT(*) FROM meetings WHERE user_id = ?",
        (user_id,),
    ).fetchone()[0]
    conn.close()
    return int(n)


# ---------------------------------------------------------------------------
# Account export helpers (unfiltered — do not reuse UI-facing query helpers)
# ---------------------------------------------------------------------------

def _rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [{k: row[k] for k in row.keys()} for row in rows]


def get_all_quiz_sessions_for_export(user_id: str) -> list[dict]:
    """All quiz sessions for a user, ordered by started_at ASC. Export-only."""
    conn = _connect()
    rows = conn.execute(
        """SELECT id, user_id, started_at, completed_at, correct_count, total_count
           FROM quiz_sessions
           WHERE user_id = ?
           ORDER BY started_at ASC""",
        (user_id,),
    ).fetchall()
    conn.close()
    return _rows_to_dicts(rows)


def get_all_mood_logs_for_export(user_id: str) -> list[dict]:
    """All mood/event log entries, ordered by logged_at ASC. Export-only."""
    conn = _connect()
    rows = conn.execute(
        """SELECT id, chunk_id, user_id, mood, event_type, logged_at
           FROM chunk_state_log
           WHERE user_id = ?
           ORDER BY logged_at ASC""",
        (user_id,),
    ).fetchall()
    conn.close()
    return _rows_to_dicts(rows)


def get_all_meetings_for_export(user_id: str) -> list[dict]:
    """All meetings, ordered by starts_at ASC. Export-only."""
    conn = _connect()
    rows = conn.execute(
        """SELECT id, user_id, title, starts_at, duration_minutes, link, notes,
                  location, created_at, updated_at
           FROM meetings
           WHERE user_id = ?
           ORDER BY starts_at ASC""",
        (user_id,),
    ).fetchall()
    conn.close()
    return [_row_to_meeting(r) for r in rows]
