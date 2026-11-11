package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/config"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

type env struct {
	t       *testing.T
	issuer  *fakeIssuer
	q       *store.Queries
	svc     *auth.Service
	base    string
	handler http.Handler
	client  *http.Client
	cookies []*http.Cookie
}

// newEnv serves the router on a real listener so the cookie jar and redirects behave like a browser.
// A non-empty baseURL skips the listener and is only usable through handler.
func newEnv(t *testing.T, baseURL string) *env {
	t.Helper()
	return newEnvWith(t, baseURL, nil)
}

// newEnvWith overrides environment variables after the defaults, which configure the Admin.
func newEnvWith(t *testing.T, baseURL string, overrides map[string]string) *env {
	t.Helper()
	gin.SetMode(gin.TestMode)

	app := httptest.NewUnstartedServer(nil)
	t.Cleanup(app.Close)
	if baseURL == "" {
		baseURL = "http://" + app.Listener.Addr().String()
	}

	for k, v := range map[string]string{
		"APP_BASE_URL":         baseURL,
		"DATABASE_PATH":        filepath.Join(t.TempDir(), "test.db"),
		"GOOGLE_CLIENT_ID":     testClientID,
		"GOOGLE_CLIENT_SECRET": testClientSecret,
		"SESSION_SECRET":       strings.Repeat("k", 32),
		"ADMIN_USERNAME":       adminUsername,
		"ADMIN_PASSWORD_HASH":  testAdminHash(),
	} {
		if o, ok := overrides[k]; ok {
			v = o
		}
		t.Setenv(k, v)
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}

	conn, err := store.Open(cfg.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })

	issuer := newFakeIssuer(t)
	q := store.New(conn)
	svc, err := auth.New(context.Background(), cfg, issuer.URL, issuer.endpoint(), q)
	if err != nil {
		t.Fatal(err)
	}

	jar, _ := cookiejar.New(nil)
	e := &env{
		t:       t,
		issuer:  issuer,
		q:       q,
		svc:     svc,
		base:    cfg.AppBaseURL,
		handler: NewRouter(testSPA, cfg, svc, conn),
		client: &http.Client{
			Jar:           jar,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	app.Config.Handler = e.handler
	app.Start()
	return e
}

// request sends one request without following redirects and records every Set-Cookie.
func (e *env) request(method, target string, body io.Reader, headers map[string]string) *http.Response {
	e.t.Helper()
	req, err := http.NewRequest(method, target, body)
	if err != nil {
		e.t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	e.cookies = append(e.cookies, resp.Cookies()...)
	return resp
}

func (e *env) api(method, path string, body io.Reader, headers map[string]string) *http.Response {
	e.t.Helper()
	if method != http.MethodGet && headers["Origin"] == "" {
		if headers == nil {
			headers = map[string]string{}
		}
		headers["Origin"] = e.base
	}
	return e.request(method, e.base+path, body, headers)
}

// follow walks redirects by hand. mutate may rewrite the callback URL before it is requested.
func (e *env) follow(target string, mutate func(*url.URL)) *http.Response {
	e.t.Helper()
	for range 10 {
		u, err := url.Parse(target)
		if err != nil {
			e.t.Fatal(err)
		}
		if mutate != nil && u.Path == auth.CallbackPath {
			mutate(u)
		}
		resp := e.request(http.MethodGet, u.String(), nil, nil)
		if resp.StatusCode < 300 || resp.StatusCode >= 400 {
			return resp
		}
		resp.Body.Close()
		loc, err := resp.Location()
		if err != nil {
			e.t.Fatal(err)
		}
		target = loc.String()
	}
	e.t.Fatal("too many redirects")
	return nil
}

func (e *env) signIn(returnPath string, mutate func(*url.URL)) *http.Response {
	e.t.Helper()
	return e.follow(e.base+"/api/auth/google/start?return="+url.QueryEscape(returnPath), mutate)
}

func (e *env) cookie(name string) *http.Cookie {
	for i := len(e.cookies) - 1; i >= 0; i-- {
		if e.cookies[i].Name == name {
			return e.cookies[i]
		}
	}
	return nil
}

func (e *env) sessionHash() []byte {
	e.t.Helper()
	c := e.cookie(auth.SessionCookie)
	if c == nil {
		e.t.Fatal("no session cookie was set")
	}
	token, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		e.t.Fatal(err)
	}
	h := sha256.Sum256(token)
	return h[:]
}

func (e *env) approve(userID string) {
	e.t.Helper()
	n, err := e.q.UpdateUserStatus(context.Background(), store.UpdateUserStatusParams{Status: string(auth.StatusApproved), ID: userID})
	if err != nil || n != 1 {
		e.t.Fatalf("approve %s: %d rows, %v", userID, n, err)
	}
}

func (e *env) signedIn() bool {
	e.t.Helper()
	resp := e.api(http.MethodGet, "/api/me", nil, nil)
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func decode[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func assertRedirectsToLogin(t *testing.T, resp *http.Response, code string) {
	t.Helper()
	resp.Body.Close()
	if got := resp.Request.URL.Path; got != "/login" || resp.Request.URL.Query().Get("error") != code {
		t.Errorf("ended at %s, want /login?error=%s", resp.Request.URL, code)
	}
}

func assertEnvelope(t *testing.T, resp *http.Response, status int, code string) {
	t.Helper()
	if resp.StatusCode != status {
		t.Errorf("status = %d, want %d", resp.StatusCode, status)
	}
	got := decode[errorEnvelope](t, resp)
	if got.Error.Code != code || got.Error.Message == "" {
		t.Errorf("error = %+v, want code %q with a message", got.Error, code)
	}
}

func TestSignInReturnsToOriginalPage(t *testing.T) {
	e := newEnv(t, "")

	resp := e.signIn("/m/2026-11", nil)
	resp.Body.Close()
	if resp.Request.URL.Path != "/m/2026-11" || resp.StatusCode != http.StatusOK {
		t.Fatalf("ended at %s with %d, want /m/2026-11 with 200", resp.Request.URL, resp.StatusCode)
	}

	me := decode[meResponse](t, e.api(http.MethodGet, "/api/me", nil, nil))
	if me.Role != "user" || me.User == nil || me.User.Email != "you@gmail.com" || me.User.Name == nil || *me.User.Name != "You" || me.User.ID == "" {
		t.Errorf("/api/me = %+v", me)
	}

	var state *http.Cookie
	for _, c := range e.cookies {
		if c.Name == "oauth_state" && c.MaxAge > 0 {
			state = c
		}
	}
	if state == nil || !state.HttpOnly || state.SameSite != http.SameSiteLaxMode || state.MaxAge != 600 || state.Secure {
		t.Errorf("state cookie = %+v", state)
	}
	session := e.cookie(auth.SessionCookie)
	if session == nil || !session.HttpOnly || session.SameSite != http.SameSiteLaxMode || session.Path != "/" ||
		session.MaxAge != 30*24*3600 || session.Secure {
		t.Errorf("session cookie = %+v", session)
	}
	if c := e.cookie("oauth_state"); c.MaxAge >= 0 {
		t.Errorf("state cookie is not cleared after the callback: %+v", c)
	}

	row, err := e.q.GetSession(context.Background(), store.GetSessionParams{TokenHash: e.sessionHash(), ExpiresAt: time.Now().UnixMilli()})
	if err != nil {
		t.Fatalf("session is not stored under the SHA-256 of the token: %v", err)
	}
	if row.Role != "user" || row.UserID == nil || *row.UserID != me.User.ID {
		t.Errorf("session row = %+v", row)
	}
}

func TestSignInTwiceUpdatesTheSameUser(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	first := decode[meResponse](t, e.api(http.MethodGet, "/api/me", nil, nil))

	e.issuer.setUser(profile{Sub: "sub-1", Email: "you@gmail.com", Name: "Renamed", Verified: true})
	e.signIn("/", nil).Body.Close()
	second := decode[meResponse](t, e.api(http.MethodGet, "/api/me", nil, nil))

	if first.User.ID != second.User.ID || *second.User.Name != "Renamed" {
		t.Errorf("first %+v, second %+v: want one user with the new name", first.User, second.User)
	}
}

func TestSignInRejections(t *testing.T) {
	tests := []struct {
		name   string
		user   *profile
		nonce  string
		mutate func(*url.URL)
		code   string
	}{
		{name: "state mismatch", code: "state_mismatch", mutate: func(u *url.URL) {
			q := u.Query()
			q.Set("state", "forged")
			u.RawQuery = q.Encode()
		}},
		{name: "ID token nonce mismatch", nonce: "forged", code: "sign_in_failed"},
		{name: "unverified email", user: &profile{Sub: "s", Email: "you@gmail.com", Verified: false}, code: "email_unverified"},
		{name: "Google reports an error", code: "access_denied", mutate: func(u *url.URL) {
			q := u.Query()
			q.Set("error", "access_denied")
			u.RawQuery = q.Encode()
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t, "")
			if tt.user != nil {
				e.issuer.setUser(*tt.user)
			}
			e.issuer.setNonce(tt.nonce)

			assertRedirectsToLogin(t, e.signIn("/m/2026-11", tt.mutate), tt.code)
			if e.cookie(auth.SessionCookie) != nil || e.signedIn() {
				t.Error("a session was created for a rejected sign-in")
			}
		})
	}
}

func TestSignInWithoutStateCookieIsRejected(t *testing.T) {
	e := newEnv(t, "")
	resp := e.request(http.MethodGet, e.base+"/api/auth/google/callback?code=x&state=y", nil, nil)
	resp.Body.Close()
	if loc := resp.Header.Get("Location"); loc != "/login?error=state_mismatch" {
		t.Errorf("Location = %q", loc)
	}
}

func TestStartRejectsNonRelativeReturn(t *testing.T) {
	e := newEnv(t, "")
	for _, ret := range []string{"https://evil.example", "//evil.example", "/\\evil.example", "evil", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=y"} {
		resp := e.api(http.MethodGet, "/api/auth/google/start?return="+url.QueryEscape(ret), nil, nil)
		if resp.Header.Get("Set-Cookie") != "" || resp.Header.Get("Location") != "" {
			t.Errorf("return %q: the flow started anyway", ret)
		}
		assertEnvelope(t, resp, http.StatusBadRequest, "invalid_return")
	}
}

func TestSessionRenewal(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	hash := e.sessionHash()
	ctx := context.Background()
	expiresAt := func() int64 {
		row, err := e.q.GetSession(ctx, store.GetSessionParams{TokenHash: hash})
		if err != nil {
			t.Fatal(err)
		}
		return row.ExpiresAt
	}

	e.cookies = nil
	e.api(http.MethodGet, "/api/me", nil, nil).Body.Close()
	if e.cookie(auth.SessionCookie) != nil {
		t.Error("a fresh session must not be renewed")
	}

	nearEnd := time.Now().Add(3 * 24 * time.Hour).UnixMilli()
	if err := e.q.ExtendSession(ctx, store.ExtendSessionParams{TokenHash: hash, ExpiresAt: nearEnd}); err != nil {
		t.Fatal(err)
	}
	e.api(http.MethodGet, "/api/me", nil, nil).Body.Close()
	renewed := e.cookie(auth.SessionCookie)
	if renewed == nil || renewed.MaxAge != 30*24*3600 || !renewed.HttpOnly {
		t.Fatalf("renewal cookie = %+v", renewed)
	}
	if got, want := expiresAt(), time.Now().Add(30*24*time.Hour).UnixMilli(); want-got > 60_000 || got > want {
		t.Errorf("expires_at = %d, want about %d", got, want)
	}
}

func TestExpiredSessionIsRejected(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	err := e.q.ExtendSession(context.Background(), store.ExtendSessionParams{TokenHash: e.sessionHash(), ExpiresAt: time.Now().Add(-time.Minute).UnixMilli()})
	if err != nil {
		t.Fatal(err)
	}
	assertEnvelope(t, e.api(http.MethodGet, "/api/me", nil, nil), http.StatusUnauthorized, "unauthorized")
}

func TestMeRequiresSession(t *testing.T) {
	e := newEnv(t, "")
	assertEnvelope(t, e.api(http.MethodGet, "/api/me", nil, nil), http.StatusUnauthorized, "unauthorized")
}

func TestLogout(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	old := e.cookie(auth.SessionCookie).Value
	hash := e.sessionHash()

	resp := e.api(http.MethodPost, "/api/auth/logout", nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", resp.StatusCode)
	}
	if c := e.cookie(auth.SessionCookie); c == nil || c.MaxAge >= 0 {
		t.Errorf("session cookie not cleared: %+v", c)
	}
	if e.signedIn() {
		t.Error("still signed in after logout")
	}

	replay := e.request(http.MethodGet, e.base+"/api/me", nil, map[string]string{"Cookie": auth.SessionCookie + "=" + old})
	assertEnvelope(t, replay, http.StatusUnauthorized, "unauthorized")
	if _, err := e.q.GetSession(context.Background(), store.GetSessionParams{TokenHash: hash}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("session row survived logout: %v", err)
	}
}

func TestLogoutRequiresSession(t *testing.T) {
	e := newEnv(t, "")
	assertEnvelope(t, e.api(http.MethodPost, "/api/auth/logout", nil, nil), http.StatusUnauthorized, "unauthorized")
}

func TestCSRF(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()

	t.Run("wrong Origin", func(t *testing.T) {
		resp := e.api(http.MethodPost, "/api/auth/logout", nil, map[string]string{"Origin": "https://evil.example"})
		assertEnvelope(t, resp, http.StatusForbidden, "forbidden_origin")
	})
	t.Run("missing Origin", func(t *testing.T) {
		resp := e.request(http.MethodPost, e.base+"/api/auth/logout", nil, nil)
		assertEnvelope(t, resp, http.StatusForbidden, "forbidden_origin")
	})
	t.Run("non-JSON mutation", func(t *testing.T) {
		resp := e.api(http.MethodPost, "/api/auth/logout", strings.NewReader("a=b"), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
		assertEnvelope(t, resp, http.StatusUnsupportedMediaType, "unsupported_media_type")
		resp = e.api(http.MethodPost, "/api/auth/logout", strings.NewReader("{}"), map[string]string{"Content-Type": "text/plain"})
		assertEnvelope(t, resp, http.StatusUnsupportedMediaType, "unsupported_media_type")
	})
	t.Run("rejected requests leave the session alone", func(t *testing.T) {
		if !e.signedIn() {
			t.Error("a rejected logout ended the session")
		}
	})
	t.Run("JSON body is accepted", func(t *testing.T) {
		resp := e.api(http.MethodPost, "/api/auth/logout", strings.NewReader("{}"), map[string]string{"Content-Type": "application/json; charset=utf-8"})
		resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("status = %d, want 204", resp.StatusCode)
		}
	})
}

func TestCookiesAreSecureOnHTTPSBase(t *testing.T) {
	e := newEnv(t, "https://cal.example.com")
	w := httptest.NewRecorder()
	e.handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/google/start?return=%2F", nil))
	cookies := w.Result().Cookies()
	if w.Code != http.StatusFound || len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly {
		t.Errorf("status %d, cookies %+v: want one Secure HttpOnly state cookie", w.Code, cookies)
	}
	redirect, err := url.Parse(w.Header().Get("Location"))
	if err != nil || redirect.Query().Get("redirect_uri") != "https://cal.example.com/api/auth/google/callback" {
		t.Errorf("Location = %q, want redirect_uri on the base URL", w.Header().Get("Location"))
	}
}
