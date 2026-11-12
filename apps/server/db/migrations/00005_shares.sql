-- +goose Up
CREATE TABLE shares (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    viewer_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at  INTEGER NOT NULL,
    accepted_at INTEGER,
    UNIQUE (owner_id, viewer_id),
    CHECK (owner_id <> viewer_id)
);

CREATE INDEX shares_viewer_id ON shares (viewer_id);

-- +goose Down
DROP TABLE shares;
