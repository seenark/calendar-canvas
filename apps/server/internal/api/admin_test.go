package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/passhash"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const (
	adminUsername = "boss"
	adminPassword = "correct horse battery staple"
)

var testAdminHash = sync.OnceValue(func() string {
	h, err := passhash.Generate(adminPassword)
	if err != nil {
		panic(err)
	}
	return h
})

func (e *env) adminLogin(ip, username, password string) *http.Response {
	e.t.Helper()
	body, _ := json.Marshal(adminLoginRequest{username, password})
	headers := map[string]string{"Content-Type": "application/json"}
	if ip != "" {
		headers[clientIPHeader] = ip
	}
	return e.api(http.MethodPost, "/api/admin/login", bytes.NewReader(body), headers)
}

func (e *env) signInAdmin() {
	e.t.Helper()
	resp := e.adminLogin("", adminUsername, adminPassword)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		e.t.Fatalf("admin login status = %d, want 204", resp.StatusCode)
	}
}

func TestAdminLoginCreatesTwelveHourSession(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	before := time.Now()
	e.signInAdmin()

	c := e.cookie(auth.SessionCookie)
	if c == nil || c.MaxAge != 12*3600 || !c.HttpOnly {
		t.Fatalf("session cookie = %+v", c)
	}
	row, err := e.q.GetSession(context.Background(), store.GetSessionParams{TokenHash: e.sessionHash()})
	if err != nil {
		t.Fatal(err)
	}
	if row.Role != auth.RoleAdmin || row.UserID != nil {
		t.Errorf("session = %+v, want role admin with no user", row)
	}
	if got, want := row.ExpiresAt, before.Add(12*time.Hour).UnixMilli(); got < want || got > want+60_000 {
		t.Errorf("expires_at = %d, want about %d", got, want)
	}

	me := decode[meResponse](t, e.api(http.MethodGet, "/api/me", nil, nil))
	if me.Role != auth.RoleAdmin || me.User != nil {
		t.Errorf("me = %+v", me)
	}
}

func TestAdminLoginRejectsWrongCredentials(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	for name, tc := range map[string][2]string{
		"wrong password": {adminUsername, "nope"},
		"wrong username": {"intruder", adminPassword},
		"empty":          {"", ""},
	} {
		resp := e.adminLogin("", tc[0], tc[1])
		if e.cookie(auth.SessionCookie) != nil {
			t.Errorf("%s: a session cookie was set", name)
		}
		assertEnvelope(t, resp, http.StatusUnauthorized, "invalid_credentials")
	}
}

func TestAdminLoginRequiresJSONBody(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	resp := e.api(http.MethodPost, "/api/admin/login", strings.NewReader("{"), map[string]string{"Content-Type": "application/json"})
	assertEnvelope(t, resp, http.StatusBadRequest, "invalid_request")
}

func TestAdminLoginIsThrottledPerClientIP(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	for range 5 {
		assertEnvelope(t, e.adminLogin("203.0.113.7", adminUsername, "nope"), http.StatusUnauthorized, "invalid_credentials")
	}
	assertEnvelope(t, e.adminLogin("203.0.113.7", adminUsername, adminPassword), http.StatusTooManyRequests, "rate_limited")
	if e.cookie(auth.SessionCookie) != nil {
		t.Error("a throttled attempt created a session")
	}

	resp := e.adminLogin("203.0.113.8", adminUsername, adminPassword)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("another IP was throttled: status %d", resp.StatusCode)
	}
}

func TestAdminLoginThrottleFallsBackToRemoteAddress(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	for range 5 {
		e.adminLogin("", adminUsername, "nope").Body.Close()
	}
	assertEnvelope(t, e.adminLogin("", adminUsername, adminPassword), http.StatusTooManyRequests, "rate_limited")
}

func TestSuccessfulAdminLoginsCountAgainstTheLimit(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	for range 5 {
		e.adminLogin("198.51.100.1", adminUsername, adminPassword).Body.Close()
	}
	assertEnvelope(t, e.adminLogin("198.51.100.1", adminUsername, adminPassword), http.StatusTooManyRequests, "rate_limited")
}

func TestAdminLoginIsDisabledWithoutConfiguration(t *testing.T) {
	for name, overrides := range map[string]map[string]string{
		"no username": {"ADMIN_USERNAME": ""},
		"no hash":     {"ADMIN_PASSWORD_HASH": ""},
	} {
		e := newEnvWith(t, "you@gmail.com", "", overrides)
		resp := e.adminLogin("", adminUsername, adminPassword)
		if e.cookie(auth.SessionCookie) != nil {
			t.Errorf("%s: a session cookie was set", name)
		}
		assertEnvelope(t, resp, http.StatusNotFound, "not_found")
	}
}

func TestAdminEndpointsRequireTheAdminRole(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	list := func() *http.Response { return e.api(http.MethodGet, "/api/admin/users", nil, nil) }
	del := func() *http.Response { return e.api(http.MethodDelete, "/api/admin/users/x", nil, nil) }

	assertEnvelope(t, list(), http.StatusUnauthorized, "unauthorized")
	assertEnvelope(t, del(), http.StatusUnauthorized, "unauthorized")

	e.signIn("/", nil).Body.Close()
	assertEnvelope(t, list(), http.StatusForbidden, "forbidden")
	assertEnvelope(t, del(), http.StatusForbidden, "forbidden")
	if n := userCount(t, e); n != 1 {
		t.Errorf("a User session deleted a User: %d left", n)
	}
}

func TestAdminSessionCannotReachUserEndpoints(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signInAdmin()

	probe := gin.New()
	probe.GET("/probe", requireRole(e.svc, auth.RoleUser), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.AddCookie(e.cookie(auth.SessionCookie))
	rec := httptest.NewRecorder()
	probe.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}

	e.cookies = nil
	e.signIn("/", nil).Body.Close()
	req = httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.AddCookie(e.cookie(auth.SessionCookie))
	rec = httptest.NewRecorder()
	probe.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("User session status = %d, want 204", rec.Code)
	}
}

func TestAdminListsUsers(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signIn("/", nil).Body.Close()
	e.signInAdmin()

	users := decode[[]adminUser](t, e.api(http.MethodGet, "/api/admin/users", nil, nil))
	if len(users) != 1 {
		t.Fatalf("users = %+v", users)
	}
	u := users[0]
	if u.Email != "you@gmail.com" || u.Name == nil || *u.Name != "You" || u.CreatedAt == 0 || u.LastLoginAt == nil || u.StrokeCount != 0 {
		t.Errorf("user = %+v", u)
	}
}

func TestAdminListUsersReturnsAnEmptyArray(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signInAdmin()
	resp := e.api(http.MethodGet, "/api/admin/users", nil, nil)
	defer resp.Body.Close()
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil || string(raw) != "[]" {
		t.Errorf("body = %s, %v", raw, err)
	}
}

func TestAdminDeletesUserAndTheirSessions(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signIn("/", nil).Body.Close()
	userSession := e.sessionHash()
	users := mustListUsers(t, e)
	e.signInAdmin()

	resp := e.api(http.MethodDelete, "/api/admin/users/"+users[0].ID, nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", resp.StatusCode)
	}
	ctx := context.Background()
	if _, err := e.q.GetUser(ctx, users[0].ID); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("user survived: %v", err)
	}
	if _, err := e.q.GetSession(ctx, store.GetSessionParams{TokenHash: userSession}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("user session survived: %v", err)
	}
	assertEnvelope(t, e.api(http.MethodDelete, "/api/admin/users/"+users[0].ID, nil, nil), http.StatusNotFound, "not_found")
	if !e.signedIn() {
		t.Error("deleting a User ended the Admin session")
	}
}

func TestAdminSessionIsNeverRenewed(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signInAdmin()
	hash := e.sessionHash()
	ctx := context.Background()
	soon := time.Now().Add(time.Hour).UnixMilli()
	if err := e.q.ExtendSession(ctx, store.ExtendSessionParams{TokenHash: hash, ExpiresAt: soon}); err != nil {
		t.Fatal(err)
	}

	e.cookies = nil
	if !e.signedIn() {
		t.Fatal("Admin session rejected before it expired")
	}
	if e.cookie(auth.SessionCookie) != nil {
		t.Error("Admin session was renewed")
	}
	row, err := e.q.GetSession(ctx, store.GetSessionParams{TokenHash: hash})
	if err != nil || row.ExpiresAt != soon {
		t.Errorf("expires_at = %d (%v), want unchanged %d", row.ExpiresAt, err, soon)
	}

	if err := e.q.ExtendSession(ctx, store.ExtendSessionParams{TokenHash: hash, ExpiresAt: time.Now().Add(-time.Second).UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	if e.signedIn() {
		t.Error("expired Admin session accepted")
	}
}

func TestUserNoLongerAllowedIsSignedOut(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	ctx := context.Background()
	now := time.Now().UnixMilli()
	user, err := e.q.UpsertUser(ctx, store.UpsertUserParams{ID: "u1", GoogleSub: "sub-gone", Email: "gone@example.org", CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	token := make([]byte, 32)
	hash := sha256.Sum256(token)
	err = e.q.CreateSession(ctx, store.CreateSessionParams{TokenHash: hash[:], UserID: &user.ID, Role: auth.RoleUser, CreatedAt: now, ExpiresAt: now + 3_600_000})
	if err != nil {
		t.Fatal(err)
	}

	cookie := auth.SessionCookie + "=" + base64.RawURLEncoding.EncodeToString(token)
	assertEnvelope(t, e.request(http.MethodGet, e.base+"/api/me", nil, map[string]string{"Cookie": cookie}), http.StatusUnauthorized, "unauthorized")
	if _, err := e.q.GetSession(ctx, store.GetSessionParams{TokenHash: hash[:]}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("session row survived: %v", err)
	}
}

func mustListUsers(t *testing.T, e *env) []store.User {
	t.Helper()
	users, err := e.q.ListUsers(context.Background())
	if err != nil || len(users) == 0 {
		t.Fatalf("users = %v, %v", users, err)
	}
	return users
}

func userCount(t *testing.T, e *env) int {
	t.Helper()
	users, err := e.q.ListUsers(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return len(users)
}
