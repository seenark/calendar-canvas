-- name: AddStroke :exec
INSERT INTO strokes (id, user_id, day, kind, color, size, points, min_x, min_y, max_x, max_y, created_at, received_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO NOTHING;

-- name: GetStrokeOwner :one
SELECT seq, user_id FROM strokes WHERE id = ?;

-- name: DeleteStroke :exec
UPDATE strokes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL;

-- name: RestoreStroke :exec
UPDATE strokes SET deleted_at = NULL WHERE id = ?;

-- name: ListStrokesBetweenDays :many
SELECT * FROM strokes
WHERE user_id = sqlc.arg(user_id) AND day >= sqlc.arg(first_day) AND day <= sqlc.arg(last_day) AND deleted_at IS NULL
ORDER BY seq;
