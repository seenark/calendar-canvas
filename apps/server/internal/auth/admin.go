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

const adminSessionTTL = 12 * time.Hour

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
	passOK := s.cfg.AdminPasswordHash.Verify(password)
	if !userOK || !passOK {
		return nil, ErrInvalidCredentials
	}

	token := randomBytes(sessionTokenByteSize)
	now := time.Now().UnixMilli()
	err := s.q.CreateSession(ctx, store.CreateSessionParams{
		TokenHash: hashToken(token),
		Role:      RoleAdmin,
		CreatedAt: now,
		ExpiresAt: now + adminSessionTTL.Milliseconds(),
	})
	if err != nil {
		return nil, fmt.Errorf("create admin session: %w", err)
	}
	return s.sessionCookie(token, adminSessionTTL), nil
}

// constantTimeEqual hashes first so the comparison time does not depend on the input lengths.
func constantTimeEqual(a, b string) bool {
	ha, hb := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}
