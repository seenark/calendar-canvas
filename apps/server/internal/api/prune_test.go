package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/seenark/calendar-canvas/apps/server/internal/purge"
)

func (a *account) prune(day string, deleteIDs ...string) *http.Response {
	a.e.t.Helper()
	body, err := json.Marshal(PruneRequest{DeleteIDs: deleteIDs})
	if err != nil {
		a.e.t.Fatal(err)
	}
	return a.do(http.MethodPost, "/api/days/"+day+"/prune", body)
}

func (a *account) mustPrune(day string, deleteIDs ...string) int64 {
	a.e.t.Helper()
	resp := a.prune(day, deleteIDs...)
	if resp.StatusCode != http.StatusOK {
		a.e.t.Fatalf("prune status = %d, want 200", resp.StatusCode)
	}
	return decode[PruneResponse](a.e.t, resp).Deleted
}

func TestPruneSoftDeletesOnlyTheUsersOwnIdsInThatDay(t *testing.T) {
	e := newEnv(t, "*", "")
	a, b := e.seedUser("a@example.com"), e.seedUser("b@example.com")
	day, otherDay := "2026-03-14", "2026-03-15"
	pruned, kept, otherDayID, foreign := newID(), newID(), newID(), newID()
	a.mustSend(addPen(pruned, day), addPen(kept, day), addPen(otherDayID, otherDay))
	b.mustSend(addPen(foreign, day))

	if got := a.mustPrune(day, pruned, otherDayID, foreign, newID()); got != 1 {
		t.Errorf("deleted = %d, want 1", got)
	}
	assertIDs(t, ids(a.month("2026-03")), kept, otherDayID)
	assertIDs(t, ids(b.month("2026-03")), foreign)

	if got := a.mustPrune(day, pruned, otherDayID, foreign); got != 0 {
		t.Errorf("repeated prune deleted = %d, want 0", got)
	}
	assertIDs(t, ids(a.month("2026-03")), kept, otherDayID)

	a.mustSend(restore(pruned))
	assertIDs(t, ids(a.month("2026-03")), pruned, kept, otherDayID)
}

func TestReplayedAddAfterPruneStaysDeleted(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	id := newID()
	seq := a.mustSend(addPen(id, "2026-03-14"))[0].Seq

	a.mustPrune("2026-03-14", id)
	again := a.mustSend(addPen(id, "2026-03-14"))

	if again[0].Seq != seq {
		t.Errorf("replayed add seq = %d, want existing %d", again[0].Seq, seq)
	}
	if got := a.month("2026-03"); len(got) != 0 {
		t.Errorf("replayed add revived a pruned Stroke: %v", ids(got))
	}
}

func TestReplayedAddBeforeThePurgeAgeStaysDeleted(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	id := newID()
	a.mustSend(addPen(id, "2026-03-14"))
	a.mustPrune("2026-03-14", id)

	job := purge.New(e.q)
	job.Now = func() time.Time { return time.Now().Add(purge.TombstoneMaxAge - time.Hour) }
	if err := job.Once(t.Context()); err != nil {
		t.Fatal(err)
	}
	a.mustSend(addPen(id, "2026-03-14"))

	if got := a.month("2026-03"); len(got) != 0 {
		t.Errorf("replayed add revived a Tombstone younger than the purge age: %v", ids(got))
	}
}

func TestPruneEnforcesTheIdCapAndValidatesTheRequest(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	day := "2026-03-14"

	many := func(n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = newID()
		}
		return out
	}

	if got := a.mustPrune(day, many(1000)...); got != 0 {
		t.Errorf("1000 unknown ids deleted = %d, want 0", got)
	}
	for name, req := range map[string]struct {
		day  string
		body string
	}{
		"1001 ids":     {day, `{"deleteIds":["` + strings.Join(many(1001), `","`) + `"]}`},
		"no ids":       {day, `{"deleteIds":[]}`},
		"missing ids":  {day, `{}`},
		"null ids":     {day, `{"deleteIds":null}`},
		"not a uuid":   {day, `{"deleteIds":["nope"]}`},
		"not JSON":     {day, `{`},
		"impossible":   {"2026-02-30", `{"deleteIds":["` + newID() + `"]}`},
		"malformed":    {"2026-3-4", `{"deleteIds":["` + newID() + `"]}`},
		"not a date":   {"today", `{"deleteIds":["` + newID() + `"]}`},
		"wrong id key": {day, `{"ids":["` + newID() + `"]}`},
	} {
		t.Run(name, func(t *testing.T) {
			resp := a.do(http.MethodPost, "/api/days/"+req.day+"/prune", []byte(req.body))
			code := "invalid_request"
			if req.day != day {
				code = "invalid_date"
			}
			assertEnvelope(t, resp, http.StatusBadRequest, code)
		})
	}
}

func TestPruneRequiresAUser(t *testing.T) {
	e := newEnv(t, "*", "")
	resp := e.api(http.MethodPost, "/api/days/2026-03-14/prune", nil, map[string]string{"Content-Type": "application/json"})
	assertEnvelope(t, resp, http.StatusUnauthorized, "unauthorized")
}
