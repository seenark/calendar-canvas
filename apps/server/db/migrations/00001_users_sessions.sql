-- +goose Up
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    google_sub    TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL,
    name          TEXT,
    avatar_url    TEXT,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE sessions (
    token_hash BLOB PRIMARY KEY,
    user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- +goose Down
DROP TABLE sessions;
DROP TABLE users;
