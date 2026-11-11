package api

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"

	"github.com/gin-gonic/gin"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

// clientIPHeader is trustworthy only because the app port is published on localhost alone, behind the tunnel.
const clientIPHeader = "CF-Connecting-IP"

type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type adminUser struct {
	ID          string              `json:"id"`
	Email       string              `json:"email"`
	Name        *string             `json:"name"`
	AvatarURL   *string             `json:"avatarUrl"`
	CreatedAt   int64               `json:"createdAt"`
	LastLoginAt *int64              `json:"lastLoginAt"`
	StrokeCount int64               `json:"strokeCount"`
	Status      auth.ApprovalStatus `json:"status"`
}

type setUserStatusRequest struct {
	Status auth.ApprovalStatus `json:"status"`
}

// adminSettable is the set of Approval statuses the Admin may assign.
var adminSettable = map[auth.ApprovalStatus]bool{
	auth.StatusApproved: true,
	auth.StatusBlocked:  true,
}

// clientIP returns the rate-limit key for r. IPv6 addresses collapse to their /64, which one subscriber controls,
// and an unparsable header falls back to the connection's address.
func clientIP(r *http.Request) string {
	if addr, err := netip.ParseAddr(r.Header.Get(clientIPHeader)); err == nil {
		return limitKey(addr)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return limitKey(addr)
	}
	return host
}

func limitKey(addr netip.Addr) string {
	addr = addr.Unmap().WithZone("")
	if addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String()
	}
	return addr.String()
}

func adminLogin(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body adminLoginRequest
		if err := c.ShouldBindJSON(&body); err != nil {
			abortError(c, http.StatusBadRequest, "invalid_request", "username and password are required")
			return
		}
		session, err := svc.AdminLogin(c.Request.Context(), clientIP(c.Request), body.Username, body.Password)
		switch {
		case errors.Is(err, auth.ErrAdminDisabled):
			abortError(c, http.StatusNotFound, "not_found", "no such API endpoint")
		case errors.Is(err, auth.ErrRateLimited):
			abortError(c, http.StatusTooManyRequests, "rate_limited", "too many sign-in attempts, try again later")
		case errors.Is(err, auth.ErrInvalidCredentials):
			abortError(c, http.StatusUnauthorized, "invalid_credentials", "wrong username or password")
		case err != nil:
			slog.Error("admin login", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
		default:
			http.SetCookie(c.Writer, session)
			c.Status(http.StatusNoContent)
		}
	}
}

func listUsers(q *store.Queries) gin.HandlerFunc {
	return func(c *gin.Context) {
		users, err := q.ListUsers(c.Request.Context())
		if err != nil {
			slog.Error("list users", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		rows, err := q.CountStrokesByUser(c.Request.Context())
		if err != nil {
			slog.Error("count strokes", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		counts := make(map[string]int64, len(rows))
		for _, r := range rows {
			counts[r.UserID] = r.StrokeCount
		}
		out := make([]adminUser, len(users))
		for i, u := range users {
			out[i] = adminUser{u.ID, u.Email, u.Name, u.AvatarUrl, u.CreatedAt, u.LastLoginAt, counts[u.ID], auth.ApprovalStatus(u.Status)}
		}
		c.JSON(http.StatusOK, out)
	}
}

func setUserStatus(conn *sql.DB) gin.HandlerFunc {
	q := store.New(conn)
	return func(c *gin.Context) {
		var body setUserStatusRequest
		if err := c.ShouldBindJSON(&body); err != nil || !adminSettable[body.Status] {
			abortError(c, http.StatusBadRequest, "invalid_request", "status must be approved or blocked")
			return
		}
		id := c.Param("id")
		ctx := c.Request.Context()
		n, err := updateStatus(ctx, conn, q, id, body.Status)
		if err != nil {
			slog.Error("update user status", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		if n == 0 {
			abortError(c, http.StatusNotFound, "not_found", "no such user")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// updateStatus sets the status and, for Blocked, ends every session of the User in the same transaction.
func updateStatus(ctx context.Context, conn *sql.DB, q *store.Queries, id string, status auth.ApprovalStatus) (int64, error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	tq := q.WithTx(tx)
	n, err := tq.UpdateUserStatus(ctx, store.UpdateUserStatusParams{Status: string(status), ID: id})
	if err != nil || n == 0 {
		return n, err
	}
	if status == auth.StatusBlocked {
		if err := tq.DeleteUserSessions(ctx, &id); err != nil {
			return 0, err
		}
	}
	return n, tx.Commit()
}

func deleteUser(q *store.Queries) gin.HandlerFunc {
	return func(c *gin.Context) {
		n, err := q.DeleteUser(c.Request.Context(), c.Param("id"))
		if err != nil {
			slog.Error("delete user", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		if n == 0 {
			abortError(c, http.StatusNotFound, "not_found", "no such user")
			return
		}
		c.Status(http.StatusNoContent)
	}
}
