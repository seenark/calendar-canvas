package api

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

func (e *env) signedInAccount() *account {
	e.t.Helper()
	return &account{e: e, cookie: auth.SessionCookie + "=" + e.cookie(auth.SessionCookie).Value}
}

func (e *env) userID(email string) string {
	e.t.Helper()
	for _, u := range mustListUsers(e.t, e) {
		if u.Email == email {
			return u.ID
		}
	}
	e.t.Fatalf("no User %s", email)
	return ""
}

func (e *env) patchStatus(id, body string) *http.Response {
	e.t.Helper()
	return e.api(http.MethodPatch, "/api/admin/users/"+id, strings.NewReader(body), map[string]string{"Content-Type": "application/json"})
}

func (e *env) myStatus() auth.ApprovalStatus {
	e.t.Helper()
	me := decode[meResponse](e.t, e.api(http.MethodGet, "/api/me", nil, nil))
	if me.User == nil {
		e.t.Fatal("/api/me has no user")
	}
	return me.User.Status
}

func TestFirstSignInIsPending(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	if got := e.myStatus(); got != auth.StatusPending {
		t.Errorf("status = %q, want pending", got)
	}
}

func TestPendingUserIsRefusedOnCalendarEndpoints(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	a := e.signedInAccount()

	assertEnvelope(t, a.do(http.MethodGet, "/api/months/2026-11", nil), http.StatusForbidden, "not_approved")
	assertEnvelope(t, a.send(addPen(newID(), "2026-11-03")), http.StatusForbidden, "not_approved")
	assertEnvelope(t, a.prune("2026-11-03"), http.StatusForbidden, "not_approved")

	if !e.signedIn() {
		t.Error("a Pending User cannot call /api/me")
	}
	resp := e.api(http.MethodPost, "/api/auth/logout", nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("logout status = %d, want 204", resp.StatusCode)
	}
}

func TestApprovingOpensCalendarOnTheSameSession(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	a := e.signedInAccount()
	id := e.userID("you@gmail.com")
	assertEnvelope(t, a.do(http.MethodGet, "/api/months/2026-11", nil), http.StatusForbidden, "not_approved")

	e.signInAdmin()
	resp := e.patchStatus(id, `{"status":"approved"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("approve status = %d, want 204", resp.StatusCode)
	}

	a.mustSend(addPen(newID(), "2026-11-03"))
	if got := len(a.month("2026-11")); got != 1 {
		t.Errorf("month has %d Strokes, want 1", got)
	}
	me := decode[meResponse](t, a.do(http.MethodGet, "/api/me", nil))
	if me.User.Status != auth.StatusApproved {
		t.Errorf("/api/me status = %q, want approved", me.User.Status)
	}
}

func TestAdminListReportsStatus(t *testing.T) {
	e := newEnv(t, "")
	e.seedUser("approved@example.com")
	e.signIn("/", nil).Body.Close()
	e.signInAdmin()

	got := map[string]auth.ApprovalStatus{}
	for _, u := range decode[[]adminUser](t, e.api(http.MethodGet, "/api/admin/users", nil, nil)) {
		got[u.Email] = u.Status
	}
	if got["approved@example.com"] != auth.StatusApproved || got["you@gmail.com"] != auth.StatusPending || len(got) != 2 {
		t.Errorf("statuses = %v", got)
	}
}

func TestSetUserStatus(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	id := e.userID("you@gmail.com")
	e.signInAdmin()

	for _, body := range []string{`{"status":"pending"}`, `{"status":"nope"}`, `{}`, `{`} {
		assertEnvelope(t, e.patchStatus(id, body), http.StatusBadRequest, "invalid_request")
	}
	assertEnvelope(t, e.patchStatus("missing", `{"status":"approved"}`), http.StatusNotFound, "not_found")
	assertEnvelope(t, e.patchStatus("missing", `{"status":"blocked"}`), http.StatusNotFound, "not_found")

	for _, status := range []string{"approved", "blocked"} {
		for range 2 {
			e.mustPatchStatus(id, status)
		}
	}
}

func (e *env) mustPatchStatus(id, status string) {
	e.t.Helper()
	resp := e.patchStatus(id, `{"status":"`+status+`"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		e.t.Fatalf("set %s status = %d, want 204", status, resp.StatusCode)
	}
}

func TestBlockingEndsExistingSessionsImmediately(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	a := e.signedInAccount()
	id := e.userID("you@gmail.com")
	e.approve(id)
	if resp := a.do(http.MethodGet, "/api/me", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("/api/me before blocking = %d, want 200", resp.StatusCode)
	}

	e.signInAdmin()
	e.mustPatchStatus(id, "blocked")

	assertEnvelope(t, a.do(http.MethodGet, "/api/me", nil), http.StatusUnauthorized, "unauthorized")
	assertEnvelope(t, a.do(http.MethodGet, "/api/months/2026-11", nil), http.StatusUnauthorized, "unauthorized")
}

func TestSessionOfABlockedUserIsRejectedEvenIfItSurvives(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	a := e.signedInAccount()
	id := e.userID("you@gmail.com")
	_, err := e.q.UpdateUserStatus(context.Background(), store.UpdateUserStatusParams{Status: string(auth.StatusBlocked), ID: id})
	if err != nil {
		t.Fatal(err)
	}
	assertEnvelope(t, a.do(http.MethodGet, "/api/me", nil), http.StatusUnauthorized, "unauthorized")
}

func TestBlockedUserSignInIsRedirectedWithoutASession(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	id := e.userID("you@gmail.com")
	e.signInAdmin()
	e.mustPatchStatus(id, "blocked")

	seen := len(e.cookies)
	assertRedirectsToLogin(t, e.signIn("/", nil), "blocked")
	for _, c := range e.cookies[seen:] {
		if c.Name == auth.SessionCookie {
			t.Errorf("blocked sign-in set a session cookie %q", c.Value)
		}
	}
}

func TestBlockedPendingUserStaysBlockedAfterSigningInAgain(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	id := e.userID("you@gmail.com")
	e.signInAdmin()
	e.mustPatchStatus(id, "blocked")
	e.signIn("/", nil).Body.Close()

	for _, u := range decode[[]adminUser](t, e.api(http.MethodGet, "/api/admin/users", nil, nil)) {
		if u.Email == "you@gmail.com" && u.Status != auth.StatusBlocked {
			t.Errorf("status = %q, want blocked", u.Status)
		}
	}
}

func TestReapprovingABlockedUserRestoresAccessAndStrokes(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	id := e.userID("you@gmail.com")
	e.approve(id)
	e.signedInAccount().mustSend(addPen(newID(), "2026-11-03"))

	e.signInAdmin()
	e.mustPatchStatus(id, "blocked")
	e.mustPatchStatus(id, "approved")

	e.signIn("/", nil).Body.Close()
	if got := len(e.signedInAccount().month("2026-11")); got != 1 {
		t.Errorf("month has %d Strokes after re-approval, want 1", got)
	}
}

func TestDeletedUserSignsInAsPending(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	id := e.userID("you@gmail.com")
	e.approve(id)
	e.signInAdmin()
	e.api(http.MethodDelete, "/api/admin/users/"+id, nil, nil).Body.Close()

	e.signIn("/", nil).Body.Close()
	if got := e.myStatus(); got != auth.StatusPending {
		t.Errorf("status = %q, want pending", got)
	}
}

func TestSigningInAgainKeepsApprovalStatus(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	e.approve(e.userID("you@gmail.com"))

	e.signIn("/", nil).Body.Close()
	if got := e.myStatus(); got != auth.StatusApproved {
		t.Errorf("status = %q, want approved", got)
	}
}
