package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
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

	for _, body := range []string{`{"status":"pending"}`, `{"status":"blocked"}`, `{"status":"nope"}`, `{}`, `{`} {
		assertEnvelope(t, e.patchStatus(id, body), http.StatusBadRequest, "invalid_request")
	}
	assertEnvelope(t, e.patchStatus("missing", `{"status":"approved"}`), http.StatusNotFound, "not_found")

	for range 2 {
		resp := e.patchStatus(id, `{"status":"approved"}`)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("approve status = %d, want 204 both times", resp.StatusCode)
		}
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
