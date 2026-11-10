package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

type account struct {
	e      *env
	cookie string
}

// seedUser inserts a User and a session directly so tests need no Google round trip.
func (e *env) seedUser(email string) *account {
	e.t.Helper()
	ctx := context.Background()
	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UnixMilli()
	if _, err := e.q.UpsertUser(ctx, store.UpsertUserParams{ID: id, GoogleSub: "sub-" + email, Email: email, CreatedAt: now}); err != nil {
		e.t.Fatal(err)
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		e.t.Fatal(err)
	}
	hash := sha256.Sum256(token)
	err := e.q.CreateSession(ctx, store.CreateSessionParams{
		TokenHash: hash[:], UserID: &id, Role: auth.RoleUser, CreatedAt: now, ExpiresAt: now + time.Hour.Milliseconds(),
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return &account{e: e, cookie: auth.SessionCookie + "=" + base64.RawURLEncoding.EncodeToString(token)}
}

func (a *account) do(method, path string, body []byte) *http.Response {
	a.e.t.Helper()
	headers := map[string]string{"Cookie": a.cookie}
	if body != nil {
		headers["Content-Type"] = "application/json"
	}
	return a.e.api(method, path, bytes.NewReader(body), headers)
}

func (a *account) send(ops ...Op) *http.Response {
	a.e.t.Helper()
	body, err := json.Marshal(OpsRequest{Ops: ops})
	if err != nil {
		a.e.t.Fatal(err)
	}
	return a.do(http.MethodPost, "/api/strokes/ops", body)
}

func (a *account) mustSend(ops ...Op) []OpResult {
	a.e.t.Helper()
	resp := a.send(ops...)
	if resp.StatusCode != http.StatusOK {
		a.e.t.Fatalf("ops status = %d, want 200", resp.StatusCode)
	}
	return decode[OpsResponse](a.e.t, resp).Results
}

func (a *account) month(ym string) []Stroke {
	a.e.t.Helper()
	resp := a.do(http.MethodGet, "/api/months/"+ym, nil)
	if resp.StatusCode != http.StatusOK {
		a.e.t.Fatalf("month status = %d, want 200", resp.StatusCode)
	}
	return decode[MonthResponse](a.e.t, resp).Strokes
}

func ids(strokes []Stroke) []string {
	out := []string{}
	for _, s := range strokes {
		out = append(out, s.ID)
	}
	return out
}

func assertIDs(t *testing.T, got []string, want ...string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("ids = %v, want %v", got, want)
	}
}

func newID() string { return uuid.Must(uuid.NewV7()).String() }

// validPoints encodes n zero-delta points, which is valid points encoding v1.
func validPoints(n int, pressure bool) []byte {
	flags := byte(0)
	if pressure {
		flags = 1
	}
	b := binary.AppendUvarint([]byte{1, flags}, uint64(n))
	for range n {
		b = append(b, 0, 0)
		if pressure {
			b = append(b, 128)
		}
	}
	return b
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func penStroke(id, day string) StrokeInput {
	color := "#1e66f5"
	return StrokeInput{
		ID: id, Day: day, Kind: "pen", Color: &color, Size: 0.01,
		Points: b64(validPoints(3, true)), BBox: []float64{0.1, 0.2, 0.3, 0.4}, CreatedAt: 1_700_000_000_000,
	}
}

func add(s StrokeInput) Op     { return Op{Op: OpAdd, Stroke: &s} }
func del(id string) Op         { return Op{Op: OpDelete, ID: id} }
func restore(id string) Op     { return Op{Op: OpRestore, ID: id} }
func addPen(id, day string) Op { return add(penStroke(id, day)) }

func TestResendingABatchCreatesNoDuplicates(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	s1, s2 := newID(), newID()
	batch := []Op{addPen(s1, "2026-03-14"), addPen(s2, "2026-03-14")}

	first := a.mustSend(batch...)
	before := a.month("2026-03")
	second := a.mustSend(batch...)
	after := a.month("2026-03")

	if first[0].Seq == 0 || first[1].Seq <= first[0].Seq {
		t.Fatalf("first seqs = %+v, want increasing and non-zero", first)
	}
	if first[0] != second[0] || first[1] != second[1] {
		t.Errorf("resend results = %+v, want %+v", second, first)
	}
	assertIDs(t, ids(after), s1, s2)
	if before[0].ReceivedAt != after[0].ReceivedAt || before[0].ReceivedAt == 0 {
		t.Errorf("receivedAt changed on resend: %d -> %d", before[0].ReceivedAt, after[0].ReceivedAt)
	}
}

func TestAddThenDeleteThenResentAddStaysDeleted(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	id := newID()

	seq := a.mustSend(addPen(id, "2026-03-14"))[0].Seq
	a.mustSend(del(id))
	again := a.mustSend(addPen(id, "2026-03-14"))

	if again[0].Seq != seq {
		t.Errorf("resent add seq = %d, want existing %d", again[0].Seq, seq)
	}
	if got := a.month("2026-03"); len(got) != 0 {
		t.Errorf("resent add revived a Tombstone: %v", ids(got))
	}
}

func TestDeleteAndRestoreToggleTheTombstone(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	id := newID()
	seq := a.mustSend(addPen(id, "2026-03-14"))[0].Seq

	a.mustSend(del(id), del(id))
	if got := a.month("2026-03"); len(got) != 0 {
		t.Fatalf("after delete = %v, want none", ids(got))
	}
	a.mustSend(restore(id), restore(id))
	got := a.month("2026-03")
	if len(got) != 1 || got[0].ID != id || got[0].Seq != seq {
		t.Errorf("after restore = %+v, want the original Stroke at seq %d", got, seq)
	}
}

func TestMissingIdsAreReportedNotRejected(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	gone1, gone2, kept := newID(), newID(), newID()

	results := a.mustSend(del(gone1), addPen(kept, "2026-03-14"), restore(gone2))

	if len(results) != 3 {
		t.Fatalf("results = %+v, want 3", results)
	}
	if results[0] != (OpResult{ID: gone1, Missing: true}) || results[2] != (OpResult{ID: gone2, Missing: true}) {
		t.Errorf("missing results = %+v", results)
	}
	if results[1].ID != kept || results[1].Seq == 0 || results[1].Missing {
		t.Errorf("add result = %+v", results[1])
	}
	assertIDs(t, ids(a.month("2026-03")), kept)
}

func TestCrossUserIdRejectsTheWholeBatch(t *testing.T) {
	e := newEnv(t, "*", "")
	a, b := e.seedUser("a@example.com"), e.seedUser("b@example.com")
	owned := newID()
	a.mustSend(addPen(owned, "2026-03-14"))

	for name, foreign := range map[string]Op{
		"delete":  del(owned),
		"restore": restore(owned),
		"add":     addPen(owned, "2026-03-15"),
	} {
		t.Run(name, func(t *testing.T) {
			fresh := newID()
			resp := b.send(addPen(fresh, "2026-03-14"), foreign, addPen(newID(), "2026-03-14"))
			assertEnvelope(t, resp, http.StatusNotFound, "not_found")

			if got := b.month("2026-03"); len(got) != 0 {
				t.Errorf("rejected batch left %v for the second User", ids(got))
			}
			own := a.month("2026-03")
			if len(own) != 1 || own[0].ID != owned || own[0].Day != "2026-03-14" {
				t.Errorf("first User's data changed: %+v", own)
			}
		})
	}
}

func TestUsersOnlySeeTheirOwnStrokes(t *testing.T) {
	e := newEnv(t, "*", "")
	a, b := e.seedUser("a@example.com"), e.seedUser("b@example.com")
	a.mustSend(addPen(newID(), "2026-03-14"))
	if got := b.month("2026-03"); len(got) != 0 {
		t.Errorf("second User sees %v", ids(got))
	}
}

func TestMonthReturnsStrokesInSeqOrderWithoutTombstones(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	late, early, dead, eraser, otherMonth, nextMonth := newID(), newID(), newID(), newID(), newID(), newID()
	eraserStroke := penStroke(eraser, "2026-03-01")
	eraserStroke.Kind, eraserStroke.Color = "eraser", nil

	a.mustSend(
		addPen(late, "2026-03-31"),
		addPen(otherMonth, "2026-02-28"),
		addPen(early, "2026-03-02"),
		addPen(dead, "2026-03-15"),
		add(eraserStroke),
		addPen(nextMonth, "2026-04-01"),
		del(dead),
	)

	got := a.month("2026-03")
	assertIDs(t, ids(got), late, early, eraser)
	for i := 1; i < len(got); i++ {
		if got[i].Seq <= got[i-1].Seq {
			t.Errorf("seq not ascending: %d then %d", got[i-1].Seq, got[i].Seq)
		}
	}

	pen := got[0]
	if pen.Day != "2026-03-31" || pen.Kind != "pen" || pen.Color == nil || *pen.Color != "#1e66f5" || pen.Size != 0.01 ||
		pen.BBox != [4]float64{0.1, 0.2, 0.3, 0.4} || pen.CreatedAt != 1_700_000_000_000 || pen.ReceivedAt == 0 ||
		pen.Points != b64(validPoints(3, true)) {
		t.Errorf("stroke did not round-trip: %+v", pen)
	}
	if got[2].Color != nil {
		t.Errorf("eraser color = %v, want null", *got[2].Color)
	}
}

func TestMonthRequiresAUserAndAValidMonth(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")

	assertEnvelope(t, e.api(http.MethodGet, "/api/months/2026-03", nil, nil), http.StatusUnauthorized, "unauthorized")
	body, _ := json.Marshal(OpsRequest{Ops: []Op{addPen(newID(), "2026-03-14")}})
	assertEnvelope(t, e.api(http.MethodPost, "/api/strokes/ops", bytes.NewReader(body), map[string]string{"Content-Type": "application/json"}), http.StatusUnauthorized, "unauthorized")
	for _, month := range []string{"2026-13", "2026-3", "march", "2026-03-01"} {
		assertEnvelope(t, a.do(http.MethodGet, "/api/months/"+month, nil), http.StatusBadRequest, "invalid_month")
	}
}

func TestLimitsAreEnforcedWithTheErrorEnvelope(t *testing.T) {
	e := newEnv(t, "*", "")
	a := e.seedUser("a@example.com")
	day := "2026-03-14"

	with := func(edit func(*StrokeInput)) Op {
		s := penStroke(newID(), day)
		edit(&s)
		return add(s)
	}
	manyOps := func(n int) []Op {
		ops := make([]Op, n)
		for i := range ops {
			ops[i] = del(newID())
		}
		return ops
	}
	badPoints := func(b []byte) Op { return with(func(s *StrokeInput) { s.Points = b64(b) }) }
	withBBox := func(box ...float64) Op { return with(func(s *StrokeInput) { s.BBox = box }) }

	rejected := map[string][]Op{
		"201 ops":                 manyOps(200),
		"size zero":               {with(func(s *StrokeInput) { s.Size = 0 })},
		"size negative":           {with(func(s *StrokeInput) { s.Size = -0.01 })},
		"size above 0.2":          {with(func(s *StrokeInput) { s.Size = 0.2001 })},
		"colour without hash":     {with(func(s *StrokeInput) { c := "1e66f5"; s.Color = &c })},
		"colour too short":        {with(func(s *StrokeInput) { c := "#1e66f"; s.Color = &c })},
		"colour not hex":          {with(func(s *StrokeInput) { c := "#GGGGGG"; s.Color = &c })},
		"colour with alpha":       {with(func(s *StrokeInput) { c := "#1e66f5ff"; s.Color = &c })},
		"pen without colour":      {with(func(s *StrokeInput) { s.Color = nil })},
		"eraser with colour":      {with(func(s *StrokeInput) { s.Kind = "eraser" })},
		"unknown kind":            {with(func(s *StrokeInput) { s.Kind = "marker" })},
		"impossible date":         {with(func(s *StrokeInput) { s.Day = "2026-02-30" })},
		"malformed date":          {with(func(s *StrokeInput) { s.Day = "2026-3-4" })},
		"bad id":                  {with(func(s *StrokeInput) { s.ID = "not-a-uuid" })},
		"bbox below -0.2":         {withBBox(-0.2001, 0, 1, 1)},
		"bbox above 1.2":          {withBBox(0, 0, 1, 1.2001)},
		"bbox of three":           {withBBox(0, 0, 1)},
		"bbox of five":            {withBBox(0, 0, 1, 1, 1)},
		"not base64":              {with(func(s *StrokeInput) { s.Points = "***" })},
		"empty points":            {with(func(s *StrokeInput) { s.Points = "" })},
		"version 2":               {badPoints(append([]byte{2}, validPoints(3, false)[1:]...))},
		"unknown flag":            {badPoints(append([]byte{1, 2}, validPoints(3, false)[2:]...))},
		"zero points":             {badPoints([]byte{1, 0, 0})},
		"4001 points":             {badPoints(validPoints(4001, false))},
		"body shorter than count": {badPoints(validPoints(3, false)[:8])},
		"body longer than count":  {badPoints(append([]byte{1, 0, 1}, make([]byte, 7)...))},
		"pressure flag missing":   {badPoints(append([]byte{1, 1}, validPoints(3, false)[2:]...))},
		"unknown op":              {{Op: "purge", ID: newID()}},
		"delete without id":       {{Op: OpDelete}},
		"delete with bad id":      {del("nope")},
		"add without stroke":      {{Op: OpAdd}},
	}
	for name, ops := range rejected {
		t.Run(name, func(t *testing.T) {
			resp := a.send(append([]Op{addPen(newID(), day)}, ops...)...)
			assertEnvelope(t, resp, http.StatusBadRequest, "invalid_request")
			if got := a.month("2026-03"); len(got) != 0 {
				t.Errorf("rejected batch stored %v", ids(got))
			}
		})
	}

	t.Run("no ops", func(t *testing.T) {
		assertEnvelope(t, a.send(), http.StatusBadRequest, "invalid_request")
	})

	t.Run("body above 2 MB", func(t *testing.T) {
		s := penStroke(newID(), day)
		s.Points = strings.Repeat("A", 2<<20)
		body, _ := json.Marshal(OpsRequest{Ops: []Op{add(s)}})
		assertEnvelope(t, a.do(http.MethodPost, "/api/strokes/ops", body), http.StatusRequestEntityTooLarge, "payload_too_large")
	})

	t.Run("body that is not JSON", func(t *testing.T) {
		assertEnvelope(t, a.do(http.MethodPost, "/api/strokes/ops", []byte("{")), http.StatusBadRequest, "invalid_request")
	})

	t.Run("limits themselves are accepted", func(t *testing.T) {
		edge := with(func(s *StrokeInput) {
			s.Size = 0.2
			s.BBox = []float64{-0.2, -0.2, 1.2, 1.2}
			s.Points = b64(validPoints(4000, true))
		})
		if got := a.mustSend(edge); got[0].Seq == 0 {
			t.Errorf("edge Stroke result = %+v", got)
		}
		if got := a.mustSend(manyOps(200)...); len(got) != 200 {
			t.Errorf("200 ops answered %d results", len(got))
		}
	})

	t.Run("three-byte coordinates fill the per-point upper bound", func(t *testing.T) {
		// Deltas of ±65535 are 3-byte zigzag varints, so every point takes 6 bytes.
		b := binary.AppendUvarint([]byte{1, 0}, maxStrokePoints)
		for i := range maxStrokePoints {
			d := int64(65535)
			if i%2 == 1 {
				d = -d
			}
			b = binary.AppendVarint(binary.AppendVarint(b, d), d)
		}
		if want := 2 + 2 + maxStrokePoints*maxPointBytes; len(b) != want {
			t.Fatalf("fixture is %d bytes, want %d", len(b), want)
		}
		stroke := with(func(s *StrokeInput) { s.Points = b64(b) })
		if got := a.mustSend(stroke); got[0].Seq == 0 {
			t.Errorf("3-byte Stroke result = %+v", got)
		}
	})
}
