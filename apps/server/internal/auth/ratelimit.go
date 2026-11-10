package auth

import (
	"sync"
	"time"
)

const (
	adminAttempts = 5
	adminWindow   = 15 * time.Minute
)

// limiter allows at most max attempts per key in any window. Rejected attempts are not recorded,
// so a blocked client is released a full window after its first counted attempt.
type limiter struct {
	mu        sync.Mutex
	max       int
	window    time.Duration
	now       func() time.Time
	attempts  map[string][]time.Time
	lastSweep time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{max: max, window: window, now: time.Now, attempts: map[string][]time.Time{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	if now.Sub(l.lastSweep) >= l.window {
		for k, times := range l.attempts {
			if live := recent(times, now, l.window); len(live) == 0 {
				delete(l.attempts, k)
			} else {
				l.attempts[k] = live
			}
		}
		l.lastSweep = now
	}

	live := recent(l.attempts[key], now, l.window)
	if len(live) >= l.max {
		l.attempts[key] = live
		return false
	}
	l.attempts[key] = append(live, now)
	return true
}

func recent(times []time.Time, now time.Time, window time.Duration) []time.Time {
	i := 0
	for i < len(times) && now.Sub(times[i]) >= window {
		i++
	}
	return times[i:]
}
