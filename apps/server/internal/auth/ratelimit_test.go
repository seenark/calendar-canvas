package auth

import (
	"testing"
	"time"
)

func TestLimiterAllowsMaxPerWindowPerKey(t *testing.T) {
	now := time.Now()
	l := newLimiter(2, time.Minute)
	l.now = func() time.Time { return now }

	if !l.allow("a") || !l.allow("a") || l.allow("a") {
		t.Fatal("key a: want two allowed then blocked")
	}
	if !l.allow("b") {
		t.Error("key b shares the budget of key a")
	}

	now = now.Add(time.Minute)
	if !l.allow("a") {
		t.Error("key a still blocked after the window")
	}
}

func TestLimiterForgetsIdleKeys(t *testing.T) {
	now := time.Now()
	l := newLimiter(2, time.Minute)
	l.now = func() time.Time { return now }
	l.allow("idle")

	now = now.Add(2 * time.Minute)
	l.allow("other")
	if _, ok := l.attempts["idle"]; ok {
		t.Error("idle key survived the sweep")
	}
}
