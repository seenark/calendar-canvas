-- name: UpsertUser :one
INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (google_sub) DO UPDATE SET
    email         = excluded.email,
    name          = excluded.name,
    avatar_url    = excluded.avatar_url,
    last_login_at = excluded.last_login_at
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = ?;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, role, created_at, expires_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetSession :one
SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?;

-- name: ExtendSession :exec
UPDATE sessions SET expires_at = ? WHERE token_hash = ?;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = ?;

-- name: PurgeExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at < ?;
