package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"golang.org/x/oauth2"

	"github.com/seenark/calendar-canvas/apps/server/internal/config"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const (
	RoleUser  = "user"
	RoleAdmin = "admin"

	SessionCookie = "session"
	stateCookie   = "oauth_state"
	// stateCookiePath keeps the state cookie off every request except the sign-in ones.
	stateCookiePath = "/api/auth/google"

	CallbackPath = "/api/auth/google/callback"

	stateTTL   = 10 * time.Minute
	sessionTTL = 30 * 24 * time.Hour
	renewBelow = 7 * 24 * time.Hour
)

var ErrInvalidReturn = errors.New("return must be a relative path")

// LoginError carries the code the login page shows. Err is for the server log only.
type LoginError struct {
	Code string
	Err  error
}

func (e *LoginError) Error() string { return e.Code + ": " + fmt.Sprint(e.Err) }
func (e *LoginError) Unwrap() error { return e.Err }

const (
	CodeStateMismatch   = "state_mismatch"
	CodeAccessDenied    = "access_denied"
	CodeEmailUnverified = "email_unverified"
	CodeNotAllowed      = "not_allowed"
	CodeSignInFailed    = "sign_in_failed"
)

const (
	defaultReturnPath    = "/"
	googleScopeEmail     = "email"
	googleScopeProfile   = "profile"
	idTokenKey           = "id_token"
	sessionTokenByteSize = 32
)

// Identity is who a request's session belongs to. User is nil for Admin sessions.
type Identity struct {
	Role string
	User *store.User
}

type Service struct {
	cfg      config.Config
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	q        *store.Queries
}

// New discovers the OIDC provider at issuer. endpoint is the OAuth2 authorize and token URL pair.
func New(ctx context.Context, cfg config.Config, issuer string, endpoint oauth2.Endpoint, q *store.Queries) (*Service, error) {
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider %s: %w", issuer, err)
	}
	return &Service{
		cfg: cfg,
		oauth: oauth2.Config{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
			Endpoint:     endpoint,
			RedirectURL:  cfg.AppBaseURL + CallbackPath,
			Scopes:       []string{oidc.ScopeOpenID, googleScopeEmail, googleScopeProfile},
		},
		verifier: provider.Verifier(&oidc.Config{ClientID: cfg.GoogleClientID}),
		q:        q,
	}, nil
}

// BeginLogin returns the Google authorization URL and the signed state cookie to set.
func (s *Service) BeginLogin(returnPath string) (string, *http.Cookie, error) {
	if returnPath == "" {
		returnPath = defaultReturnPath
	}
	if !validReturn(returnPath) {
		return "", nil, ErrInvalidReturn
	}
	st := loginState{
		State:    randomToken(16),
		Verifier: oauth2.GenerateVerifier(),
		Nonce:    randomToken(16),
		Return:   returnPath,
		Exp:      time.Now().Add(stateTTL).Unix(),
	}
	value, err := signState(s.cfg.SessionSecret, st)
	if err != nil {
		return "", nil, err
	}
	authURL := s.oauth.AuthCodeURL(st.State, oauth2.S256ChallengeOption(st.Verifier), oidc.Nonce(st.Nonce))
	return authURL, s.cookie(stateCookie, value, stateCookiePath, int(stateTTL/time.Second)), nil
}

// ClearStateCookie expires the state cookie once the callback has consumed it.
func (s *Service) ClearStateCookie() *http.Cookie {
	return s.cookie(stateCookie, "", stateCookiePath, -1)
}

func (s *Service) ClearSessionCookie() *http.Cookie {
	return s.cookie(SessionCookie, "", "/", -1)
}

// FinishLogin completes the callback and returns the session cookie and the path to redirect to.
func (s *Service) FinishLogin(ctx context.Context, r *http.Request) (*http.Cookie, string, error) {
	c, err := r.Cookie(stateCookie)
	if err != nil {
		return nil, "", &LoginError{CodeStateMismatch, errors.New("missing state cookie")}
	}
	st, err := verifyState(s.cfg.SessionSecret, c.Value, time.Now())
	if err != nil {
		return nil, "", &LoginError{CodeStateMismatch, err}
	}
	q := r.URL.Query()
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(st.State)) != 1 {
		return nil, "", &LoginError{CodeStateMismatch, errors.New("state does not match cookie")}
	}
	if e := q.Get("error"); e != "" {
		return nil, "", &LoginError{CodeAccessDenied, errors.New(e)}
	}

	tok, err := s.oauth.Exchange(ctx, q.Get("code"), oauth2.VerifierOption(st.Verifier))
	if err != nil {
		return nil, "", &LoginError{CodeSignInFailed, fmt.Errorf("exchange code: %w", err)}
	}
	raw, _ := tok.Extra(idTokenKey).(string)
	idToken, err := s.verifier.Verify(ctx, raw)
	if err != nil {
		return nil, "", &LoginError{CodeSignInFailed, fmt.Errorf("verify ID token: %w", err)}
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(st.Nonce)) != 1 {
		return nil, "", &LoginError{CodeSignInFailed, errors.New("ID token nonce mismatch")}
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, "", &LoginError{CodeSignInFailed, fmt.Errorf("read ID token claims: %w", err)}
	}
	if claims.Email == "" || !claims.EmailVerified {
		return nil, "", &LoginError{CodeEmailUnverified, fmt.Errorf("email %q is not verified", claims.Email)}
	}
	if !s.cfg.AllowedEmails.Allows(claims.Email) {
		return nil, "", &LoginError{CodeNotAllowed, fmt.Errorf("email %q is not in ALLOWED_EMAILS", claims.Email)}
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, "", &LoginError{CodeSignInFailed, err}
	}
	now := time.Now().UnixMilli()
	user, err := s.q.UpsertUser(ctx, store.UpsertUserParams{
		ID:          id.String(),
		GoogleSub:   idToken.Subject,
		Email:       claims.Email,
		Name:        nonEmpty(claims.Name),
		AvatarUrl:   nonEmpty(claims.Picture),
		CreatedAt:   now,
		LastLoginAt: &now,
	})
	if err != nil {
		return nil, "", &LoginError{CodeSignInFailed, fmt.Errorf("upsert user: %w", err)}
	}

	token := randomBytes(sessionTokenByteSize)
	err = s.q.CreateSession(ctx, store.CreateSessionParams{
		TokenHash: hashToken(token),
		UserID:    &user.ID,
		Role:      RoleUser,
		CreatedAt: now,
		ExpiresAt: now + sessionTTL.Milliseconds(),
	})
	if err != nil {
		return nil, "", &LoginError{CodeSignInFailed, fmt.Errorf("create session: %w", err)}
	}
	return s.sessionCookie(token), st.Return, nil
}

// Authenticate resolves the session cookie. It returns a nil Identity for a missing, malformed or expired
// session. A non-nil cookie must be set on the response to renew the session.
func (s *Service) Authenticate(ctx context.Context, r *http.Request) (*Identity, *http.Cookie, error) {
	token, ok := cookieToken(r)
	if !ok {
		return nil, nil, nil
	}
	now := time.Now()
	hash := hashToken(token)
	sess, err := s.q.GetSession(ctx, store.GetSessionParams{TokenHash: hash, ExpiresAt: now.UnixMilli()})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}

	identity := &Identity{Role: sess.Role}
	if sess.UserID != nil {
		user, err := s.q.GetUser(ctx, *sess.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil
		}
		if err != nil {
			return nil, nil, err
		}
		identity.User = &user
	}

	if sess.Role != RoleUser || time.UnixMilli(sess.ExpiresAt).Sub(now) >= renewBelow {
		return identity, nil, nil
	}
	err = s.q.ExtendSession(ctx, store.ExtendSessionParams{TokenHash: hash, ExpiresAt: now.Add(sessionTTL).UnixMilli()})
	if err != nil {
		slog.Error("renew session", "error", err)
		return identity, nil, nil
	}
	return identity, s.sessionCookie(token), nil
}

func (s *Service) Logout(ctx context.Context, r *http.Request) error {
	token, ok := cookieToken(r)
	if !ok {
		return nil
	}
	return s.q.DeleteSession(ctx, hashToken(token))
}

func (s *Service) sessionCookie(token []byte) *http.Cookie {
	return s.cookie(SessionCookie, base64.RawURLEncoding.EncodeToString(token), "/", int(sessionTTL/time.Second))
}

func (s *Service) cookie(name, value, path string, maxAgeSeconds int) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   maxAgeSeconds,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.SecureCookies(),
	}
}

func cookieToken(r *http.Request) ([]byte, bool) {
	c, err := r.Cookie(SessionCookie)
	if err != nil {
		return nil, false
	}
	token, err := base64.RawURLEncoding.DecodeString(c.Value)
	return token, err == nil && len(token) == sessionTokenByteSize
}

func hashToken(token []byte) []byte {
	h := sha256.Sum256(token)
	return h[:]
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

func randomToken(n int) string {
	return base64.RawURLEncoding.EncodeToString(randomBytes(n))
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// validReturn accepts only a same-origin relative path: one slash, no scheme, host, backslash or control character.
func validReturn(p string) bool {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") ||
		strings.ContainsFunc(p, func(r rune) bool { return r == '\\' || unicode.IsControl(r) }) {
		return false
	}
	u, err := url.Parse(p)
	return err == nil && u.Scheme == "" && u.Host == ""
}
