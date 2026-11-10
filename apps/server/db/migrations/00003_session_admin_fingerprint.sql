-- +goose Up
ALTER TABLE sessions ADD COLUMN admin_fingerprint TEXT;

-- +goose Down
ALTER TABLE sessions DROP COLUMN admin_fingerprint;
