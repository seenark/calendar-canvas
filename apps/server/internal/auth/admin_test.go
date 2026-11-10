package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/seenark/calendar-canvas/apps/server/internal/config"
	"github.com/seenark/calendar-canvas/apps/server/internal/passhash"
)

func testService(t *testing.T, verify func(string) bool) *Service {
	t.Helper()
	hash, err := passhash.Parse("$argon2id$v=19$m=8,t=1,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA")
	if err != nil {
		t.Fatal(err)
	}
	return &Service{
		cfg:          config.Config{AdminUsername: "boss", AdminPasswordHash: hash},
		adminLimiter: newLimiter(adminAttempts, adminWindow),
		verifySlots:  make(chan struct{}, adminVerifySlots),
		verifyWait:   5 * time.Second,
		verify:       verify,
	}
}

func TestAdminLoginRunsAtMostTwoVerificationsAtOnce(t *testing.T) {
	var running, peak atomic.Int32
	svc := testService(t, func(string) bool {
		n := running.Add(1)
		defer running.Add(-1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		time.Sleep(30 * time.Millisecond)
		return false
	})

	var wg sync.WaitGroup
	errs := make([]error, 10)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = svc.AdminLogin(context.Background(), fmt.Sprintf("203.0.113.%d", i), "boss", "nope")
		}()
	}
	wg.Wait()

	if got := peak.Load(); got != adminVerifySlots {
		t.Errorf("peak concurrent verifications = %d, want %d", got, adminVerifySlots)
	}
	for i, err := range errs {
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Errorf("login %d: err = %v, want ErrInvalidCredentials", i, err)
		}
	}
}

func TestAdminLoginRefusesWhenNoVerificationSlotFrees(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{}, adminVerifySlots)
	svc := testService(t, func(string) bool {
		started <- struct{}{}
		<-release
		return false
	})
	svc.verifyWait = 20 * time.Millisecond

	var wg sync.WaitGroup
	for i := range adminVerifySlots {
		wg.Add(1)
		go func() {
			defer wg.Done()
			svc.AdminLogin(context.Background(), fmt.Sprintf("198.51.100.%d", i), "boss", "nope")
		}()
	}
	for range adminVerifySlots {
		<-started
	}

	_, err := svc.AdminLogin(context.Background(), "192.0.2.1", "boss", "nope")
	if !errors.Is(err, ErrRateLimited) {
		t.Errorf("err = %v, want ErrRateLimited", err)
	}
	close(release)
	wg.Wait()
}
