package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

// seedNamed is seedUser with a display name, which candidates are sorted by.
func (e *env) seedNamed(name string) *account {
	e.t.Helper()
	email := strings.ToLower(name) + "@example.com"
	a := e.seedUser(email)
	_, err := e.q.UpsertUser(context.Background(), store.UpsertUserParams{ID: newID(), GoogleSub: "sub-" + email, Email: email, Name: &name, CreatedAt: 1})
	if err != nil {
		e.t.Fatal(err)
	}
	return a
}

func (a *account) postJSON(path string, v any) *http.Response {
	a.e.t.Helper()
	body, err := json.Marshal(v)
	if err != nil {
		a.e.t.Fatal(err)
	}
	return a.do(http.MethodPost, path, body)
}

func (a *account) status(method, path string) int {
	a.e.t.Helper()
	resp := a.do(method, path, nil)
	resp.Body.Close()
	return resp.StatusCode
}

func (a *account) invite(viewerID string) string {
	a.e.t.Helper()
	resp := a.postJSON("/api/shares", CreateShareRequest{ViewerID: viewerID})
	if resp.StatusCode != http.StatusCreated {
		a.e.t.Fatalf("invite status = %d, want 201", resp.StatusCode)
	}
	return decode[CreateShareResponse](a.e.t, resp).ID
}

func (a *account) shares() SharesResponse {
	a.e.t.Helper()
	return decode[SharesResponse](a.e.t, a.do(http.MethodGet, "/api/shares", nil))
}

func (a *account) candidates() []string {
	a.e.t.Helper()
	var names []string
	for _, u := range decode[CandidatesResponse](a.e.t, a.do(http.MethodGet, "/api/shares/candidates", nil)).Users {
		names = append(names, *u.Name)
	}
	return names
}

func (a *account) sharedMonth(ownerID, ym string) *http.Response {
	a.e.t.Helper()
	return a.do(http.MethodGet, "/api/users/"+ownerID+"/months/"+ym, nil)
}

// sharePair seeds an Owner with one Stroke on 2026-11-03 and a Viewer.
func sharePair(e *env) (owner, viewer *account) {
	owner, viewer = e.seedNamed("Owner"), e.seedNamed("Viewer")
	owner.mustSend(addPen(newID(), "2026-11-03"))
	return
}

func TestInviteAcceptReadMonth(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	oid, vid := e.userID("owner@example.com"), e.userID("viewer@example.com")

	assertEnvelope(t, viewer.sharedMonth(oid, "2026-11"), http.StatusNotFound, "not_found")
	shareID := owner.invite(vid)

	if got := owner.shares().Viewers; len(got) != 1 || got[0].ID != shareID || got[0].Viewer.ID != vid || got[0].Status != "pending" {
		t.Errorf("owner viewers = %+v", got)
	}
	inv := viewer.shares().Invitations
	if len(inv) != 1 || inv[0].ID != shareID || inv[0].Owner.ID != oid || *inv[0].Owner.Name != "Owner" || inv[0].CreatedAt == 0 {
		t.Errorf("invitations = %+v", inv)
	}
	assertEnvelope(t, viewer.sharedMonth(oid, "2026-11"), http.StatusNotFound, "not_found")

	if got := viewer.status(http.MethodPost, "/api/shares/"+shareID+"/accept"); got != http.StatusNoContent {
		t.Fatalf("accept status = %d, want 204", got)
	}
	if got := owner.shares().Viewers[0].Status; got != "accepted" {
		t.Errorf("owner sees status %q, want accepted", got)
	}
	s := viewer.shares()
	if len(s.Invitations) != 0 || len(s.Calendars) != 1 || s.Calendars[0].Owner.ID != oid {
		t.Errorf("viewer shares = %+v", s)
	}
	resp := viewer.sharedMonth(oid, "2026-11")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("shared month status = %d, want 200", resp.StatusCode)
	}
	if got := decode[MonthResponse](t, resp).Strokes; len(got) != 1 || got[0].Day != "2026-11-03" {
		t.Errorf("shared month = %+v", got)
	}
	assertEnvelope(t, viewer.sharedMonth(oid, "nope"), http.StatusBadRequest, "invalid_month")
}

func TestSharingIsOneWayAndReadOnly(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	vid := e.userID("viewer@example.com")
	viewer.status(http.MethodPost, "/api/shares/"+owner.invite(vid)+"/accept")

	assertEnvelope(t, owner.sharedMonth(vid, "2026-11"), http.StatusNotFound, "not_found")
	if got := len(owner.shares().Calendars); got != 0 {
		t.Errorf("owner has %d shared calendars, want 0", got)
	}
	// The Viewer's own month stays theirs.
	if got := len(viewer.month("2026-11")); got != 0 {
		t.Errorf("viewer's own month has %d Strokes, want 0", got)
	}
}

func TestDeclineDeletesAndAllowsReinvite(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	vid := e.userID("viewer@example.com")
	id := owner.invite(vid)

	if got := viewer.status(http.MethodPost, "/api/shares/"+id+"/decline"); got != http.StatusNoContent {
		t.Fatalf("decline status = %d, want 204", got)
	}
	if got := owner.shares().Viewers; len(got) != 0 {
		t.Errorf("owner still lists %+v after decline", got)
	}
	if got := viewer.shares().Invitations; len(got) != 0 {
		t.Errorf("viewer still lists %+v after decline", got)
	}
	if got := viewer.status(http.MethodPost, "/api/shares/"+id+"/decline"); got != http.StatusNotFound {
		t.Errorf("second decline status = %d, want 404", got)
	}
	owner.invite(vid)
}

func TestDeclineOnlyAppliesToPendingInvitations(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	id := owner.invite(e.userID("viewer@example.com"))
	viewer.status(http.MethodPost, "/api/shares/"+id+"/accept")

	if got := viewer.status(http.MethodPost, "/api/shares/"+id+"/decline"); got != http.StatusNotFound {
		t.Errorf("decline of accepted Share = %d, want 404", got)
	}
	if got := viewer.status(http.MethodPost, "/api/shares/"+id+"/accept"); got != http.StatusNotFound {
		t.Errorf("second accept = %d, want 404", got)
	}
	if got := len(viewer.shares().Calendars); got != 1 {
		t.Errorf("viewer has %d calendars, want 1", got)
	}
}

func TestOwnerRevokesPendingAndAccepted(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	oid, vid := e.userID("owner@example.com"), e.userID("viewer@example.com")

	id := owner.invite(vid)
	if got := owner.status(http.MethodDelete, "/api/shares/"+id); got != http.StatusNoContent {
		t.Fatalf("revoke pending = %d, want 204", got)
	}
	if got := len(viewer.shares().Invitations); got != 0 {
		t.Errorf("viewer has %d invitations after revoke, want 0", got)
	}

	id = owner.invite(vid)
	viewer.status(http.MethodPost, "/api/shares/"+id+"/accept")
	if got := owner.status(http.MethodDelete, "/api/shares/"+id); got != http.StatusNoContent {
		t.Fatalf("revoke accepted = %d, want 204", got)
	}
	assertEnvelope(t, viewer.sharedMonth(oid, "2026-11"), http.StatusNotFound, "not_found")
	if got := owner.status(http.MethodDelete, "/api/shares/"+id); got != http.StatusNotFound {
		t.Errorf("second revoke = %d, want 404", got)
	}
}

func TestViewerLeavesAcceptedShareOnly(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	oid, vid := e.userID("owner@example.com"), e.userID("viewer@example.com")
	id := owner.invite(vid)

	if got := viewer.status(http.MethodDelete, "/api/shares/"+id); got != http.StatusNotFound {
		t.Errorf("viewer deleting a pending Share = %d, want 404 (decline is the way)", got)
	}
	viewer.status(http.MethodPost, "/api/shares/"+id+"/accept")
	if got := viewer.status(http.MethodDelete, "/api/shares/"+id); got != http.StatusNoContent {
		t.Fatalf("leave = %d, want 204", got)
	}
	assertEnvelope(t, viewer.sharedMonth(oid, "2026-11"), http.StatusNotFound, "not_found")
	if got := len(owner.shares().Viewers); got != 0 {
		t.Errorf("owner still lists %d viewers after leave, want 0", got)
	}
}

func TestStrangerGetsNotFoundOnEveryShareRoute(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	stranger := e.seedNamed("Stranger")
	oid, vid := e.userID("owner@example.com"), e.userID("viewer@example.com")
	id := owner.invite(vid)

	for _, r := range [][2]string{
		{http.MethodPost, "/api/shares/" + id + "/accept"},
		{http.MethodPost, "/api/shares/" + id + "/decline"},
		{http.MethodDelete, "/api/shares/" + id},
		{http.MethodPost, "/api/shares/" + id + "/accept"},
	} {
		assertEnvelope(t, stranger.do(r[0], r[1], nil), http.StatusNotFound, "not_found")
	}
	// The Owner is no party to accept or decline.
	assertEnvelope(t, owner.do(http.MethodPost, "/api/shares/"+id+"/accept", nil), http.StatusNotFound, "not_found")
	assertEnvelope(t, owner.do(http.MethodPost, "/api/shares/"+id+"/decline", nil), http.StatusNotFound, "not_found")

	viewer.status(http.MethodPost, "/api/shares/"+id+"/accept")
	assertEnvelope(t, stranger.sharedMonth(oid, "2026-11"), http.StatusNotFound, "not_found")
	assertEnvelope(t, stranger.do(http.MethodDelete, "/api/shares/"+id, nil), http.StatusNotFound, "not_found")
	if got := len(owner.shares().Viewers); got != 1 {
		t.Errorf("stranger changed the Share: owner has %d viewers, want 1", got)
	}
	if s := stranger.shares(); len(s.Viewers)+len(s.Calendars)+len(s.Invitations) != 0 {
		t.Errorf("stranger sees %+v", s)
	}
}

func TestViewersOfOneOwnerDoNotSeeEachOther(t *testing.T) {
	e := newEnv(t, "")
	owner, v1 := sharePair(e)
	v2 := e.seedNamed("Second")
	for email, v := range map[string]*account{"viewer@example.com": v1, "second@example.com": v2} {
		v.status(http.MethodPost, "/api/shares/"+owner.invite(e.userID(email))+"/accept")
	}
	for _, v := range []*account{v1, v2} {
		s := v.shares()
		if len(s.Viewers) != 0 || len(s.Calendars) != 1 {
			t.Errorf("viewer sees %+v, want only the Owner's calendar", s)
		}
	}
}

func TestCreateShareValidation(t *testing.T) {
	e := newEnv(t, "")
	owner, _ := sharePair(e)
	vid := e.userID("viewer@example.com")

	assertEnvelope(t, owner.postJSON("/api/shares", CreateShareRequest{ViewerID: e.userID("owner@example.com")}), http.StatusBadRequest, "invalid_request")
	assertEnvelope(t, owner.postJSON("/api/shares", map[string]string{}), http.StatusBadRequest, "invalid_request")
	assertEnvelope(t, owner.postJSON("/api/shares", CreateShareRequest{ViewerID: "missing"}), http.StatusNotFound, "not_found")

	e.signIn("/", nil).Body.Close() // a Pending User
	assertEnvelope(t, owner.postJSON("/api/shares", CreateShareRequest{ViewerID: e.userID("you@gmail.com")}), http.StatusNotFound, "not_found")

	owner.invite(vid)
	assertEnvelope(t, owner.postJSON("/api/shares", CreateShareRequest{ViewerID: vid}), http.StatusConflict, "already_shared")
}

func TestCandidates(t *testing.T) {
	e := newEnv(t, "")
	owner := e.seedNamed("Owner")
	e.seedNamed("Zed")
	e.seedNamed("Amy")
	invited := e.seedNamed("Invited")
	e.seedNamed("Blocked")
	e.signIn("/", nil).Body.Close() // Pending, never listed

	e.signInAdmin()
	e.mustPatchStatus(e.userID("blocked@example.com"), "blocked")
	owner.invite(e.userID("invited@example.com"))

	got := strings.Join(owner.candidates(), ",")
	if got != "Amy,Zed" {
		t.Errorf("candidates = %s, want Amy,Zed", got)
	}
	// Share rows are directional: the invited User still sees the Owner as a candidate.
	if got := strings.Join(invited.candidates(), ","); !strings.Contains(got, "Owner") {
		t.Errorf("invited candidates = %s, want Owner included", got)
	}
}

func TestBlockedPartyHidesShareUntilReapproved(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	oid, vid := e.userID("owner@example.com"), e.userID("viewer@example.com")
	viewer.status(http.MethodPost, "/api/shares/"+owner.invite(vid)+"/accept")
	e.signInAdmin()

	e.mustPatchStatus(oid, "blocked")
	if s := viewer.shares(); len(s.Calendars) != 0 || len(s.Invitations) != 0 {
		t.Errorf("viewer shares after block = %+v", s)
	}
	assertEnvelope(t, viewer.sharedMonth(oid, "2026-11"), http.StatusNotFound, "not_found")

	e.mustPatchStatus(oid, "approved")
	if got := len(viewer.shares().Calendars); got != 1 {
		t.Errorf("viewer has %d calendars after re-approval, want 1", got)
	}
	if got := len(decode[MonthResponse](t, viewer.sharedMonth(oid, "2026-11")).Strokes); got != 1 {
		t.Errorf("shared month has %d Strokes after re-approval, want 1", got)
	}
}

func TestHiddenInvitationCannotBeAccepted(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	id := owner.invite(e.userID("viewer@example.com"))
	e.signInAdmin()

	e.mustPatchStatus(e.userID("owner@example.com"), "blocked")
	assertEnvelope(t, viewer.do(http.MethodPost, "/api/shares/"+id+"/accept", nil), http.StatusNotFound, "not_found")

	e.signInAdmin() // the Viewer's response may have replaced the jar's session cookie
	e.mustPatchStatus(e.userID("owner@example.com"), "approved")
	if got := viewer.status(http.MethodPost, "/api/shares/"+id+"/accept"); got != http.StatusNoContent {
		t.Errorf("accept after re-approval = %d, want 204", got)
	}
}

func TestBlockedViewerIsHiddenFromOwner(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	vid := e.userID("viewer@example.com")
	viewer.status(http.MethodPost, "/api/shares/"+owner.invite(vid)+"/accept")
	e.signInAdmin()

	e.mustPatchStatus(vid, "blocked")
	if got := owner.shares().Viewers; len(got) != 0 {
		t.Errorf("owner lists %+v for a Blocked Viewer", got)
	}

	e.mustPatchStatus(vid, "approved")
	if got := len(owner.shares().Viewers); got != 1 {
		t.Errorf("owner lists %d viewers after the Viewer's re-approval, want 1", got)
	}
}

func TestDeletingAUserDeletesTheirShares(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	third := e.seedNamed("Third")
	oid, vid, tid := e.userID("owner@example.com"), e.userID("viewer@example.com"), e.userID("third@example.com")
	viewer.status(http.MethodPost, "/api/shares/"+owner.invite(vid)+"/accept")
	third.invite(oid)
	e.signInAdmin()

	e.api(http.MethodDelete, "/api/admin/users/"+vid, nil, nil).Body.Close()
	if got := owner.shares().Viewers; len(got) != 0 {
		t.Errorf("owner lists %+v after the Viewer was deleted", got)
	}
	e.api(http.MethodDelete, "/api/admin/users/"+tid, nil, nil).Body.Close()
	if got := owner.shares().Invitations; len(got) != 0 {
		t.Errorf("owner still has %+v from a deleted User", got)
	}
}

func TestShareResponsesNeverExposeEmail(t *testing.T) {
	e := newEnv(t, "")
	owner, viewer := sharePair(e)
	vid := e.userID("viewer@example.com")
	id := owner.invite(vid)

	raw := func(a *account, path string) string {
		resp := a.do(http.MethodGet, path, nil)
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	check := func() {
		for _, a := range []*account{owner, viewer} {
			for _, p := range []string{"/api/shares", "/api/shares/candidates"} {
				if body := raw(a, p); strings.Contains(body, "@") || strings.Contains(strings.ToLower(body), "email") {
					t.Errorf("GET %s leaks an email: %s", p, body)
				}
			}
		}
	}
	check()
	viewer.status(http.MethodPost, "/api/shares/"+id+"/accept")
	check()
}

func TestShareRoutesRequireApprovedUser(t *testing.T) {
	e := newEnv(t, "")
	e.signIn("/", nil).Body.Close()
	a := e.signedInAccount()

	for _, r := range [][2]string{
		{http.MethodGet, "/api/shares"}, {http.MethodGet, "/api/shares/candidates"}, {http.MethodPost, "/api/shares"},
		{http.MethodPost, "/api/shares/x/accept"}, {http.MethodPost, "/api/shares/x/decline"}, {http.MethodDelete, "/api/shares/x"},
		{http.MethodGet, "/api/users/x/months/2026-11"},
	} {
		assertEnvelope(t, a.do(r[0], r[1], nil), http.StatusForbidden, "not_approved")
	}
}
