-- +goose Up
CREATE TABLE strokes (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    id          TEXT NOT NULL UNIQUE,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day         TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('pen', 'eraser')),
    color       TEXT,
    size        REAL NOT NULL,
    points      BLOB NOT NULL,
    min_x       REAL NOT NULL,
    min_y       REAL NOT NULL,
    max_x       REAL NOT NULL,
    max_y       REAL NOT NULL,
    created_at  INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    deleted_at  INTEGER,
    CHECK ((kind = 'pen') = (color IS NOT NULL))
);

CREATE INDEX strokes_user_day_seq ON strokes (user_id, day, seq);

-- +goose Down
DROP TABLE strokes;
