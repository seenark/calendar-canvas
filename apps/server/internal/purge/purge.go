// Package purge is the daily storage cleanup: Tombstone purge (ADR 0001) and expired sessions.
package purge

import (
	"context"
	"log/slog"
	"time"

	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const (
	// TombstoneMaxAge must stay longer than the client persister's 7-day maxAge (ADR 0001).
	TombstoneMaxAge = 30 * 24 * time.Hour
	Interval        = 24 * time.Hour
	firstRunDelay   = time.Minute
)

type Job struct {
	Q      *store.Queries
	Now    func() time.Time
	MaxAge time.Duration
}

func New(q *store.Queries) Job {
	return Job{Q: q, Now: time.Now, MaxAge: TombstoneMaxAge}
}

// Once hard-deletes Tombstones older than MaxAge and sessions that have expired.
func (j Job) Once(ctx context.Context) error {
	now := j.Now()
	cutoff := now.Add(-j.MaxAge).UnixMilli()
	strokes, err := j.Q.PurgeTombstones(ctx, &cutoff)
	if err != nil {
		return err
	}
	sessions, err := j.Q.PurgeExpiredSessions(ctx, now.UnixMilli())
	if err != nil {
		return err
	}
	slog.Info("purge", "tombstones", strokes, "sessions", sessions)
	return nil
}

// Run calls Once after firstRunDelay and then every Interval until ctx is cancelled.
func (j Job) Run(ctx context.Context) {
	j.run(ctx, firstRunDelay, Interval)
}

func (j Job) run(ctx context.Context, first, every time.Duration) {
	timer := time.NewTimer(first)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := j.Once(ctx); err != nil {
				slog.Error("purge", "error", err)
			}
			timer.Reset(every)
		}
	}
}
