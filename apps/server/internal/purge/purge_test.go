package purge

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

var now = time.Date(2026, 3, 14, 12, 0, 0, 0, time.UTC)

func open(t *testing.T) (*sql.DB, *store.Queries) {
	t.Helper()
	conn, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn, store.New(conn)
}

func column(t *testing.T, conn *sql.DB, query string) []string {
	t.Helper()
	rows, err := conn.Query(query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func TestOncePurgesOldTombstonesKeepsYoungerAndLiveStrokes(t *testing.T) {
	conn, q := open(t)
	ctx := context.Background()
	if _, err := q.UpsertUser(ctx, store.UpsertUserParams{ID: "u1", GoogleSub: "sub", Email: "a@example.com"}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"live", "young", "old", "boundary"} {
		color := "#1e66f5"
		err := q.AddStroke(ctx, store.AddStrokeParams{ID: id, UserID: "u1", Day: "2026-03-01", Kind: "pen", Color: &color, Size: 0.01, Points: []byte{1}})
		if err != nil {
			t.Fatal(err)
		}
	}
	tombstone := func(id string, age time.Duration) {
		at := now.Add(-age).UnixMilli()
		if err := q.DeleteStroke(ctx, store.DeleteStrokeParams{DeletedAt: &at, ID: id, UserID: "u1"}); err != nil {
			t.Fatal(err)
		}
	}
	tombstone("young", TombstoneMaxAge-time.Hour)
	tombstone("old", TombstoneMaxAge+time.Hour)
	tombstone("boundary", TombstoneMaxAge)

	job := Job{Q: q, Now: func() time.Time { return now }, MaxAge: TombstoneMaxAge}
	for range 2 {
		if err := job.Once(ctx); err != nil {
			t.Fatal(err)
		}
		got := column(t, conn, "SELECT id FROM strokes ORDER BY seq")
		if len(got) != 3 || got[0] != "live" || got[1] != "young" || got[2] != "boundary" {
			t.Fatalf("strokes after purge = %v, want live, young, boundary", got)
		}
	}
}

func TestOncePurgesOnlyExpiredSessions(t *testing.T) {
	conn, q := open(t)
	ctx := context.Background()
	for _, s := range []struct {
		hash    string
		expires time.Time
	}{
		{"expired", now.Add(-time.Second)},
		{"valid", now.Add(time.Second)},
	} {
		err := q.CreateSession(ctx, store.CreateSessionParams{TokenHash: []byte(s.hash), Role: "admin", CreatedAt: 1, ExpiresAt: s.expires.UnixMilli()})
		if err != nil {
			t.Fatal(err)
		}
	}

	if err := (Job{Q: q, Now: func() time.Time { return now }, MaxAge: TombstoneMaxAge}).Once(ctx); err != nil {
		t.Fatal(err)
	}
	if got := column(t, conn, "SELECT CAST(token_hash AS TEXT) FROM sessions"); len(got) != 1 || got[0] != "valid" {
		t.Errorf("sessions after purge = %v, want valid", got)
	}
}

func TestRunPurgesRepeatedlyAndStopsOnCancel(t *testing.T) {
	_, q := open(t)
	var runs atomic.Int32
	job := Job{Q: q, Now: func() time.Time { runs.Add(1); return now }, MaxAge: TombstoneMaxAge}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { job.run(ctx, 0, time.Millisecond); close(done) }()

	deadline := time.After(5 * time.Second)
	for runs.Load() < 3 {
		select {
		case <-deadline:
			t.Fatalf("job ran %d times, want at least 3", runs.Load())
		case <-time.After(time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-deadline:
		t.Fatal("Run did not stop after cancel")
	}
}
