PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    password_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chunks (
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
    -- FSRS-4 spaced-repetition state (1 = Learning). See intelligence/memory/scheduler.py.
    fsrs_due TEXT,
    fsrs_state INTEGER DEFAULT 1,
    fsrs_step INTEGER DEFAULT 0,
    fsrs_stability REAL,
    fsrs_difficulty REAL,
    fsrs_last_review TEXT
);

CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT REFERENCES chunks(id),
    user_id TEXT REFERENCES users(id),
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS quiz_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    correct_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_retention ON chunks(last_accessed, access_count);
CREATE INDEX IF NOT EXISTS idx_chunks_fsrs_due ON chunks(user_id, fsrs_due);
CREATE INDEX IF NOT EXISTS idx_access_log_chunk ON access_log(chunk_id, accessed_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS chunk_state_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT,
    user_id TEXT NOT NULL,
    mood TEXT NOT NULL,
    event_type TEXT NOT NULL,
    logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chunk_state_log_user_time
    ON chunk_state_log(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_chunk_state_log_chunk
    ON chunk_state_log(chunk_id);

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
