package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/config"
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

func TestAdminLoginThrottleSharesOneBucketPerIPv6Prefix(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	for i := range 5 {
		e.adminLogin(fmt.Sprintf("2001:db8:1:2::%x", i+1), adminUsername, "nope").Body.Close()
	}
	assertEnvelope(t, e.adminLogin("2001:db8:1:2:ffff:ffff:ffff:ffff", adminUsername, adminPassword), http.StatusTooManyRequests, "rate_limited")

	resp := e.adminLogin("2001:db8:1:3::1", adminUsername, adminPassword)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("another /64 was throttled: status %d", resp.StatusCode)
	}
}

func TestClientIPNormalizesTheLimiterKey(t *testing.T) {
	for _, tc := range []struct{ header, remote, want string }{
		{"203.0.113.7", "10.0.0.1:1", "203.0.113.7"},
		{"::ffff:203.0.113.7", "10.0.0.1:1", "203.0.113.7"},
		{"2001:db8:1:2:aaaa:bbbb:cccc:dddd", "10.0.0.1:1", "2001:db8:1:2::/64"},
		{"fe80::1%eth0", "10.0.0.1:1", "fe80::/64"},
		{"not-an-ip", "10.0.0.1:1", "10.0.0.1"},
		{"", "[2001:db8:9:9::5]:1", "2001:db8:9:9::/64"},
		{"", "unix", "unix"},
	} {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.RemoteAddr = tc.remote
		if tc.header != "" {
			r.Header.Set(clientIPHeader, tc.header)
		}
		if got := clientIP(r); got != tc.want {
			t.Errorf("clientIP(header %q, remote %q) = %q, want %q", tc.header, tc.remote, got, tc.want)
		}
	}
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

func TestAdminSessionGetsForbiddenOnUserCalendarEndpoints(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signInAdmin()
	assertEnvelope(t, e.api(http.MethodGet, "/api/months/2026-11", nil, nil), http.StatusForbidden, "forbidden")
	body := []byte(`{"ops":[]}`)
	assertEnvelope(t, e.api(http.MethodPost, "/api/strokes/ops", bytes.NewReader(body), map[string]string{"Content-Type": "application/json"}), http.StatusForbidden, "forbidden")
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

func TestAdminStrokeCountIgnoresDeletedStrokes(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	e.seedUser("b@example.com")
	a.mustSend(addPen("11111111-1111-7111-8111-111111111111", "2026-11-03"), addPen("22222222-2222-7222-8222-222222222222", "2026-11-04"), addPen("33333333-3333-7333-8333-333333333333", "2026-11-05"))
	a.mustSend(del("33333333-3333-7333-8333-333333333333"))
	e.signInAdmin()

	counts := map[string]int64{}
	for _, u := range decode[[]adminUser](t, e.api(http.MethodGet, "/api/admin/users", nil, nil)) {
		counts[u.Email] = u.StrokeCount
	}
	if counts["a@example.com"] != 2 || counts["b@example.com"] != 0 {
		t.Errorf("counts = %v, want a=2 b=0", counts)
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
	e := newEnv(t, "*", "")
	const victimStroke, otherStroke = "11111111-1111-7111-8111-111111111111", "44444444-4444-7444-8444-444444444444"
	e.seedUser("other@example.com").mustSend(addPen(otherStroke, "2026-11-03"))
	e.signIn("/", nil).Body.Close()
	userSession := e.sessionHash()
	var victim store.User
	for _, u := range mustListUsers(t, e) {
		if u.Email == "you@gmail.com" {
			victim = u
		}
	}
	(&account{e: e, cookie: auth.SessionCookie + "=" + e.cookie(auth.SessionCookie).Value}).mustSend(addPen(victimStroke, "2026-11-03"))
	e.signInAdmin()

	resp := e.api(http.MethodDelete, "/api/admin/users/"+victim.ID, nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", resp.StatusCode)
	}
	ctx := context.Background()
	if _, err := e.q.GetUser(ctx, victim.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("user survived: %v", err)
	}
	if _, err := e.q.GetSession(ctx, store.GetSessionParams{TokenHash: userSession}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("user session survived: %v", err)
	}
	if _, err := e.q.GetStrokeOwner(ctx, victimStroke); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("user Stroke survived: %v", err)
	}
	if _, err := e.q.GetStrokeOwner(ctx, otherStroke); err != nil {
		t.Errorf("another User's Stroke was removed: %v", err)
	}
	assertEnvelope(t, e.api(http.MethodDelete, "/api/admin/users/"+victim.ID, nil, nil), http.StatusNotFound, "not_found")
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

func (e *env) newService(hash string) *auth.Service {
	e.t.Helper()
	e.t.Setenv("ADMIN_PASSWORD_HASH", hash)
	cfg, err := config.Load()
	if err != nil {
		e.t.Fatal(err)
	}
	svc, err := auth.New(context.Background(), cfg, e.issuer.URL, e.issuer.endpoint(), e.q)
	if err != nil {
		e.t.Fatal(err)
	}
	return svc
}

func TestRestartWithAdminSignInDisabledEndsAdminSessions(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signInAdmin()
	hash := e.sessionHash()

	e.newService("")
	if _, err := e.q.GetSession(context.Background(), store.GetSessionParams{TokenHash: hash}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("Admin session survived a restart with Admin sign-in disabled: %v", err)
	}
}

func TestAdminSessionIsSignedOutWhenAdminDisabledAtRequestTime(t *testing.T) {
	e := newEnvWith(t, "you@gmail.com", "", map[string]string{"ADMIN_USERNAME": "", "ADMIN_PASSWORD_HASH": ""})
	ctx := context.Background()
	token := make([]byte, 32)
	hash := sha256.Sum256(token)
	now := time.Now().UnixMilli()
	if err := e.q.CreateSession(ctx, store.CreateSessionParams{TokenHash: hash[:], Role: auth.RoleAdmin, CreatedAt: now, ExpiresAt: now + 3_600_000}); err != nil {
		t.Fatal(err)
	}

	cookie := auth.SessionCookie + "=" + base64.RawURLEncoding.EncodeToString(token)
	assertEnvelope(t, e.request(http.MethodGet, e.base+"/api/admin/users", nil, map[string]string{"Cookie": cookie}), http.StatusUnauthorized, "unauthorized")
	if _, err := e.q.GetSession(ctx, store.GetSessionParams{TokenHash: hash[:]}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("session row survived: %v", err)
	}
}

func TestRotatingTheAdminPasswordHashEndsOldAdminSessions(t *testing.T) {
	e := newEnv(t, "you@gmail.com", "")
	e.signInAdmin()
	hash := e.sessionHash()

	e.newService(testAdminHash())
	if _, err := e.q.GetSession(context.Background(), store.GetSessionParams{TokenHash: hash}); err != nil {
		t.Fatalf("restart with the same hash ended the session: %v", err)
	}

	rotated, err := passhash.Generate("another password")
	if err != nil {
		t.Fatal(err)
	}
	e.newService(rotated)
	if _, err := e.q.GetSession(context.Background(), store.GetSessionParams{TokenHash: hash}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("Admin session survived a rotated hash: %v", err)
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
