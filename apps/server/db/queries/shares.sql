-- name: ListShareCandidates :many
SELECT u.id, u.name, u.avatar_url FROM users u
WHERE u.status = 'approved' AND u.id <> sqlc.arg(me)
  AND u.id NOT IN (SELECT viewer_id FROM shares WHERE owner_id = sqlc.arg(me))
ORDER BY u.name, u.id;

-- name: CreateShare :execrows
INSERT INTO shares (id, owner_id, viewer_id, status, created_at)
VALUES (?, ?, ?, 'pending', ?)
ON CONFLICT (owner_id, viewer_id) DO NOTHING;

-- name: ListShareViewers :many
SELECT s.id, s.status, u.id AS user_id, u.name, u.avatar_url
FROM shares s JOIN users u ON u.id = s.viewer_id
WHERE s.owner_id = ? AND u.status = 'approved'
ORDER BY s.created_at, s.id;

-- name: ListSharedCalendars :many
SELECT s.id, u.id AS user_id, u.name, u.avatar_url
FROM shares s JOIN users u ON u.id = s.owner_id
WHERE s.viewer_id = ? AND s.status = 'accepted' AND u.status = 'approved'
ORDER BY s.created_at, s.id;

-- name: ListInvitations :many
SELECT s.id, s.created_at, u.id AS user_id, u.name, u.avatar_url
FROM shares s JOIN users u ON u.id = s.owner_id
WHERE s.viewer_id = ? AND s.status = 'pending' AND u.status = 'approved'
ORDER BY s.created_at, s.id;

-- name: AcceptShare :execrows
UPDATE shares SET status = 'accepted', accepted_at = ?
WHERE shares.id = ? AND shares.viewer_id = ? AND shares.status = 'pending'
  AND EXISTS (SELECT 1 FROM users o WHERE o.id = shares.owner_id AND o.status = 'approved');

-- name: DeclineShare :execrows
DELETE FROM shares WHERE id = ? AND viewer_id = ? AND status = 'pending';

-- name: DeleteShare :execrows
DELETE FROM shares
WHERE id = sqlc.arg(id) AND (owner_id = sqlc.arg(me) OR (viewer_id = sqlc.arg(me) AND status = 'accepted'));

-- name: CanViewCalendar :one
SELECT EXISTS (
    SELECT 1 FROM shares s JOIN users o ON o.id = s.owner_id
    WHERE s.owner_id = ? AND s.viewer_id = ? AND s.status = 'accepted' AND o.status = 'approved'
);
