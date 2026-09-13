"""Upgrade path for an existing database.

Every other test starts from an empty file, where schema.sql creates the current
tables outright and _migrate() has nothing to do. That hides ordering bugs:
init_db() runs executescript(schema.sql) BEFORE _migrate(), so anything in
schema.sql that references a column added by a migration will fail against a
real, already-populated database even though the whole suite is green.

These tests build a pre-migration database by hand and then run init_db() over
it, which is what happens on a deploy.
"""

import sqlite3

from database.db import init_db

# The chunks table exactly as it stood immediately before retention_anchor:
# FSRS columns and folder present, anchor absent. This is the shape of a real
# deployed database at the time of this change.
LEGACY_SCHEMA = """
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    password_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    source_file TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    complexity_score REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER DEFAULT 0,
    folder TEXT DEFAULT NULL,
    fsrs_due TEXT,
    fsrs_state INTEGER DEFAULT 1,
    fsrs_step INTEGER DEFAULT 0,
    fsrs_stability REAL,
    fsrs_difficulty REAL,
    fsrs_last_review TEXT
);
"""


def _legacy_db(path, rows=()):
    conn = sqlite3.connect(str(path))
    conn.executescript(LEGACY_SCHEMA)
    conn.execute("INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.c', 'A')")
    for chunk_id, last_accessed in rows:
        conn.execute(
            "INSERT INTO chunks (id, user_id, source_file, content, created_at, last_accessed) "
            "VALUES (?, 'u1', 'f.md', 'x', ?, ?)",
            (chunk_id, last_accessed, last_accessed),
        )
    conn.commit()
    conn.close()


def test_init_db_upgrades_a_pre_anchor_database(tmp_path, monkeypatch):
    db = tmp_path / "legacy.db"
    _legacy_db(db, rows=[("c1", "2026-01-01T00:00:00+00:00")])
    monkeypatch.setenv("DORY_DB_PATH", str(db))

    init_db()  # must not raise

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    cols = {r[1] for r in conn.execute("PRAGMA table_info(chunks)")}
    assert "retention_anchor" in cols

    indexes = {r[1] for r in conn.execute("PRAGMA index_list(chunks)")}
    assert "idx_chunks_retention_anchor" in indexes

    row = conn.execute("SELECT * FROM chunks WHERE id = 'c1'").fetchone()
    assert row["retention_anchor"] == "2026-01-01T00:00:00+00:00", "backfilled from last_accessed"
    conn.close()


def test_init_db_is_idempotent_over_an_upgraded_database(tmp_path, monkeypatch):
    db = tmp_path / "legacy.db"
    _legacy_db(db, rows=[("c1", "2026-01-01T00:00:00+00:00")])
    monkeypatch.setenv("DORY_DB_PATH", str(db))

    init_db()
    init_db()  # a second boot must be a no-op, not an error

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM chunks WHERE id = 'c1'").fetchone()
    assert row["retention_anchor"] == "2026-01-01T00:00:00+00:00"
    conn.close()


def test_init_db_on_a_fresh_file_also_gets_the_index(tmp_path, monkeypatch):
    db = tmp_path / "fresh.db"
    monkeypatch.setenv("DORY_DB_PATH", str(db))

    init_db()

    conn = sqlite3.connect(str(db))
    cols = {r[1] for r in conn.execute("PRAGMA table_info(chunks)")}
    indexes = {r[1] for r in conn.execute("PRAGMA index_list(chunks)")}
    assert "retention_anchor" in cols
    assert "idx_chunks_retention_anchor" in indexes
    conn.close()
