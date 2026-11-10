package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const (
	pointsVersion   = 1
	pointsFlagPress = 1
	maxStrokePoints = 4000
	// Each coordinate is a zigzag varint of a delta within ±65535, so 1 to 3 bytes.
	minPointBytes = 2
	maxPointBytes = 6
)

var (
	colorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	errNotOwner  = errors.New("stroke belongs to another user")
)

type strokeHandlers struct {
	conn *sql.DB
	q    *store.Queries
}

func newStrokeHandlers(conn *sql.DB) *strokeHandlers {
	return &strokeHandlers{conn: conn, q: store.New(conn)}
}

func currentUserID(c *gin.Context) string {
	return c.MustGet(identityKey).(*auth.Identity).User.ID
}

func (h *strokeHandlers) month(c *gin.Context) {
	first, err := time.Parse("2006-01", c.Param("month"))
	if err != nil {
		abortError(c, http.StatusBadRequest, "invalid_month", "month must be YYYY-MM")
		return
	}
	rows, err := h.q.ListStrokesBetweenDays(c.Request.Context(), store.ListStrokesBetweenDaysParams{
		UserID:   currentUserID(c),
		FirstDay: first.Format(time.DateOnly),
		LastDay:  first.AddDate(0, 1, -1).Format(time.DateOnly),
	})
	if err != nil {
		slog.Error("list month strokes", "error", err)
		abortError(c, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	res := MonthResponse{Strokes: make([]Stroke, len(rows))}
	for i, r := range rows {
		res.Strokes[i] = Stroke{
			ID: r.ID, Seq: r.Seq, Day: r.Day, Kind: r.Kind, Color: r.Color, Size: r.Size,
			Points:     base64.StdEncoding.EncodeToString(r.Points),
			BBox:       [4]float64{r.MinX, r.MinY, r.MaxX, r.MaxY},
			CreatedAt:  r.CreatedAt,
			ReceivedAt: r.ReceivedAt,
		}
	}
	c.JSON(http.StatusOK, res)
}

func (h *strokeHandlers) ops(c *gin.Context) {
	var req OpsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortBindError(c, err)
		return
	}
	decoded := make([][]byte, len(req.Ops))
	for i, op := range req.Ops {
		points, err := op.check()
		if err != nil {
			abortError(c, http.StatusBadRequest, "invalid_request", fmt.Sprintf("ops[%d]: %v", i, err))
			return
		}
		decoded[i] = points
	}

	results, err := h.apply(c.Request.Context(), currentUserID(c), req.Ops, decoded)
	switch {
	case errors.Is(err, errNotOwner):
		abortError(c, http.StatusNotFound, "not_found", "stroke not found")
	case err != nil:
		slog.Error("apply stroke ops", "error", err)
		abortError(c, http.StatusInternalServerError, "internal", "internal error")
	default:
		c.JSON(http.StatusOK, OpsResponse{Results: results})
	}
}

// apply runs the batch in order in one transaction; any error rolls everything back.
func (h *strokeHandlers) apply(ctx context.Context, userID string, ops []Op, points [][]byte) ([]OpResult, error) {
	tx, err := h.conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := h.q.WithTx(tx)
	now := time.Now().UnixMilli()

	results := make([]OpResult, 0, len(ops))
	for i, op := range ops {
		id := op.ID
		if op.Op == OpAdd {
			s := op.Stroke
			id = s.ID
			err = q.AddStroke(ctx, store.AddStrokeParams{
				ID: s.ID, UserID: userID, Day: s.Day, Kind: s.Kind, Color: s.Color, Size: s.Size, Points: points[i],
				MinX: s.BBox[0], MinY: s.BBox[1], MaxX: s.BBox[2], MaxY: s.BBox[3],
				CreatedAt: s.CreatedAt, ReceivedAt: now,
			})
			if err != nil {
				return nil, err
			}
		}

		owner, err := q.GetStrokeOwner(ctx, id)
		if errors.Is(err, sql.ErrNoRows) {
			results = append(results, OpResult{ID: id, Missing: true})
			continue
		}
		if err != nil {
			return nil, err
		}
		if owner.UserID != userID {
			return nil, errNotOwner
		}

		switch op.Op {
		case OpAdd:
			results = append(results, OpResult{ID: id, Seq: owner.Seq})
			continue
		case OpDelete:
			err = q.DeleteStroke(ctx, store.DeleteStrokeParams{DeletedAt: &now, ID: id, UserID: userID})
		case OpRestore:
			err = q.RestoreStroke(ctx, store.RestoreStrokeParams{ID: id, UserID: userID})
		}
		if err != nil {
			return nil, err
		}
		results = append(results, OpResult{ID: id})
	}
	return results, tx.Commit()
}

func (h *strokeHandlers) prune(c *gin.Context) {
	day := c.Param("date")
	if _, err := time.Parse(time.DateOnly, day); err != nil {
		abortError(c, http.StatusBadRequest, "invalid_date", "date must be YYYY-MM-DD")
		return
	}
	var req PruneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortBindError(c, err)
		return
	}
	ids, err := json.Marshal(req.DeleteIDs)
	if err != nil {
		slog.Error("encode prune ids", "error", err)
		abortError(c, http.StatusInternalServerError, "internal", "internal error")
		return
	}

	// One UPDATE statement is one transaction: every matching row is deleted or none.
	now := time.Now().UnixMilli()
	deleted, err := h.q.PruneDayStrokes(c.Request.Context(), store.PruneDayStrokesParams{
		DeletedAt: &now, UserID: currentUserID(c), Day: day, Ids: string(ids),
	})
	if err != nil {
		slog.Error("prune day strokes", "error", err)
		abortError(c, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	c.JSON(http.StatusOK, PruneResponse{Deleted: deleted})
}

// check validates what binding tags cannot express and returns the decoded points of an add.
func (o Op) check() ([]byte, error) {
	if o.Op != OpAdd {
		if o.ID == "" {
			return nil, fmt.Errorf("%s needs an id", o.Op)
		}
		return nil, nil
	}
	s := o.Stroke
	if s == nil {
		return nil, errors.New("add needs a stroke")
	}
	switch {
	case s.Kind == "pen" && (s.Color == nil || !colorPattern.MatchString(*s.Color)):
		return nil, errors.New("a pen stroke needs a #RRGGBB color")
	case s.Kind == "eraser" && s.Color != nil:
		return nil, errors.New("an eraser stroke has no color")
	}
	return decodePoints(s.Points)
}

// decodePoints checks points encoding v1 without decoding the points: the version, the flags,
// the declared count and the length bounds the count implies.
func decodePoints(encoded string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("points is not valid base64")
	}
	if len(b) < 3 || b[0] != pointsVersion {
		return nil, errors.New("unsupported points version")
	}
	if b[1]&^pointsFlagPress != 0 {
		return nil, errors.New("unknown points flags")
	}
	n, read := binary.Uvarint(b[2:])
	if read <= 0 || n < 1 || n > maxStrokePoints {
		return nil, fmt.Errorf("point count must be 1 to %d", maxStrokePoints)
	}
	perMin, perMax := uint64(minPointBytes), uint64(maxPointBytes)
	if b[1]&pointsFlagPress != 0 {
		perMin++
		perMax++
	}
	if body := uint64(len(b) - 2 - read); body < n*perMin || body > n*perMax {
		return nil, errors.New("points length does not match the point count")
	}
	return b, nil
}

func abortBindError(c *gin.Context, err error) {
	var tooLarge *http.MaxBytesError
	var invalid validator.ValidationErrors
	switch {
	case errors.As(err, &tooLarge):
		abortError(c, http.StatusRequestEntityTooLarge, "payload_too_large", "request body is too large")
	case errors.As(err, &invalid):
		abortError(c, http.StatusBadRequest, "invalid_request", fmt.Sprintf("%s failed %q validation", invalid[0].Namespace(), invalid[0].Tag()))
	default:
		abortError(c, http.StatusBadRequest, "invalid_request", "request body is not valid JSON")
	}
}
