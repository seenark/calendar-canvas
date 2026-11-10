package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const (
	adminSessionTTL  = 12 * time.Hour
	adminVerifySlots = 2
	adminVerifyWait  = 2 * time.Second
)

var (
	ErrAdminDisabled      = errors.New("admin sign-in is not configured")
	ErrRateLimited        = errors.New("too many sign-in attempts")
	ErrInvalidCredentials = errors.New("invalid credentials")
)

// AdminLogin checks the credentials and returns the session cookie. Every attempt from ip counts against the limit.
func (s *Service) AdminLogin(ctx context.Context, ip, username, password string) (*http.Cookie, error) {
	if !s.cfg.AdminEnabled() {
		return nil, ErrAdminDisabled
	}
	if !s.adminLimiter.allow(ip) {
		return nil, ErrRateLimited
	}

	// Both checks always run so the response time does not reveal which one failed.
	userOK := constantTimeEqual(username, s.cfg.AdminUsername)
	passOK, err := s.verifyPassword(ctx, password)
	if err != nil {
		return nil, err
	}
	if !userOK || !passOK {
		return nil, ErrInvalidCredentials
	}

	token := randomBytes(sessionTokenByteSize)
	now := time.Now().UnixMilli()
	fingerprint := s.cfg.AdminPasswordHash.Fingerprint()
	err = s.q.CreateSession(ctx, store.CreateSessionParams{
		TokenHash:        hashToken(token),
		Role:             RoleAdmin,
		CreatedAt:        now,
		ExpiresAt:        now + adminSessionTTL.Milliseconds(),
		AdminFingerprint: &fingerprint,
	})
	if err != nil {
		return nil, fmt.Errorf("create admin session: %w", err)
	}
	return s.sessionCookie(token, adminSessionTTL), nil
}

// verifyPassword waits briefly for one of the process-wide verification slots and gives up with ErrRateLimited,
// so concurrent logins from many addresses cannot exhaust memory.
func (s *Service) verifyPassword(ctx context.Context, password string) (bool, error) {
	timer := time.NewTimer(s.verifyWait)
	defer timer.Stop()
	select {
	case s.verifySlots <- struct{}{}:
		defer func() { <-s.verifySlots }()
		return s.verify(password), nil
	case <-timer.C:
		return false, ErrRateLimited
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

// revokeStaleAdminSessions ends Admin sessions created under another ADMIN_PASSWORD_HASH, or all of them when
// Admin sign-in is off.
func (s *Service) revokeStaleAdminSessions(ctx context.Context) error {
	var fingerprint string
	if s.cfg.AdminEnabled() {
		fingerprint = s.cfg.AdminPasswordHash.Fingerprint()
	}
	if err := s.q.DeleteAdminSessionsExceptFingerprint(ctx, &fingerprint); err != nil {
		return fmt.Errorf("revoke stale admin sessions: %w", err)
	}
	return nil
}

// constantTimeEqual hashes first so the comparison time does not depend on the input lengths.
func constantTimeEqual(a, b string) bool {
	ha, hb := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}
