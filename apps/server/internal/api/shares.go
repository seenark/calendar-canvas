package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

type shareHandlers struct {
	q       *store.Queries
	strokes *strokeHandlers
}

func newShareHandlers(q *store.Queries, strokes *strokeHandlers) *shareHandlers {
	return &shareHandlers{q: q, strokes: strokes}
}

func internalError(c *gin.Context, what string, err error) {
	slog.Error(what, "error", err)
	abortError(c, http.StatusInternalServerError, "internal", "internal error")
}

func (h *shareHandlers) candidates(c *gin.Context) {
	rows, err := h.q.ListShareCandidates(c.Request.Context(), currentUserID(c))
	if err != nil {
		internalError(c, "list share candidates", err)
		return
	}
	res := CandidatesResponse{Users: make([]PublicUser, len(rows))}
	for i, r := range rows {
		res.Users[i] = PublicUser{r.ID, r.Name, r.AvatarUrl}
	}
	c.JSON(http.StatusOK, res)
}

func (h *shareHandlers) list(c *gin.Context) {
	ctx, me := c.Request.Context(), currentUserID(c)
	viewers, err := h.q.ListShareViewers(ctx, me)
	if err != nil {
		internalError(c, "list share viewers", err)
		return
	}
	calendars, err := h.q.ListSharedCalendars(ctx, me)
	if err != nil {
		internalError(c, "list shared calendars", err)
		return
	}
	invitations, err := h.q.ListInvitations(ctx, me)
	if err != nil {
		internalError(c, "list invitations", err)
		return
	}
	res := SharesResponse{
		Viewers:     make([]ShareViewer, len(viewers)),
		Calendars:   make([]SharedCalendar, len(calendars)),
		Invitations: make([]Invitation, len(invitations)),
	}
	for i, r := range viewers {
		res.Viewers[i] = ShareViewer{r.ID, PublicUser{r.UserID, r.Name, r.AvatarUrl}, r.Status}
	}
	for i, r := range calendars {
		res.Calendars[i] = SharedCalendar{r.ID, PublicUser{r.UserID, r.Name, r.AvatarUrl}}
	}
	for i, r := range invitations {
		res.Invitations[i] = Invitation{r.ID, PublicUser{r.UserID, r.Name, r.AvatarUrl}, r.CreatedAt}
	}
	c.JSON(http.StatusOK, res)
}

func (h *shareHandlers) create(c *gin.Context) {
	var req CreateShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortBindError(c, err)
		return
	}
	ctx, me := c.Request.Context(), currentUserID(c)
	if req.ViewerID == me {
		abortError(c, http.StatusBadRequest, "invalid_request", "cannot share with yourself")
		return
	}
	viewer, err := h.q.GetUser(ctx, req.ViewerID)
	if err == nil && auth.ApprovalStatus(viewer.Status) != auth.StatusApproved {
		err = sql.ErrNoRows
	}
	if errors.Is(err, sql.ErrNoRows) {
		abortError(c, http.StatusNotFound, "not_found", "no such user")
		return
	}
	if err != nil {
		internalError(c, "get share viewer", err)
		return
	}
	id := uuid.Must(uuid.NewV7()).String()
	n, err := h.q.CreateShare(ctx, store.CreateShareParams{ID: id, OwnerID: me, ViewerID: viewer.ID, CreatedAt: time.Now().UnixMilli()})
	if err != nil {
		internalError(c, "create share", err)
		return
	}
	if n == 0 {
		abortError(c, http.StatusConflict, "already_shared", "already shared with this user")
		return
	}
	c.JSON(http.StatusCreated, CreateShareResponse{ID: id})
}

func (h *shareHandlers) accept(c *gin.Context) {
	now := time.Now().UnixMilli()
	n, err := h.q.AcceptShare(c.Request.Context(), store.AcceptShareParams{AcceptedAt: &now, ID: c.Param("id"), ViewerID: currentUserID(c)})
	h.noContent(c, "accept share", n, err)
}

func (h *shareHandlers) decline(c *gin.Context) {
	n, err := h.q.DeclineShare(c.Request.Context(), store.DeclineShareParams{ID: c.Param("id"), ViewerID: currentUserID(c)})
	h.noContent(c, "decline share", n, err)
}

func (h *shareHandlers) remove(c *gin.Context) {
	n, err := h.q.DeleteShare(c.Request.Context(), store.DeleteShareParams{ID: c.Param("id"), Me: currentUserID(c)})
	h.noContent(c, "delete share", n, err)
}

// noContent answers 204 when a statement changed a row; zero rows means the caller is no party to a matching Share.
func (h *shareHandlers) noContent(c *gin.Context, what string, n int64, err error) {
	switch {
	case err != nil:
		internalError(c, what, err)
	case n == 0:
		abortError(c, http.StatusNotFound, "not_found", "no such share")
	default:
		c.Status(http.StatusNoContent)
	}
}

// month serves an Owner's month to a Viewer with an accepted Share; both must be Approved.
func (h *shareHandlers) month(c *gin.Context) {
	owner := c.Param("ownerId")
	ok, err := h.q.CanViewCalendar(c.Request.Context(), store.CanViewCalendarParams{OwnerID: owner, ViewerID: currentUserID(c)})
	if err != nil {
		internalError(c, "check share", err)
		return
	}
	if !ok {
		abortError(c, http.StatusNotFound, "not_found", "no such calendar")
		return
	}
	h.strokes.writeMonth(c, owner)
}
