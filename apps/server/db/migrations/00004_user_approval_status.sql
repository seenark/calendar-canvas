-- +goose Up
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked'));
UPDATE users SET status = 'approved';

-- +goose Down
ALTER TABLE users DROP COLUMN status;
