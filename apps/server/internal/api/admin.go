package api

import (
	"errors"
	"log/slog"
	"net"
	"net/http"

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
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	Name        *string `json:"name"`
	AvatarURL   *string `json:"avatarUrl"`
	CreatedAt   int64   `json:"createdAt"`
	LastLoginAt *int64  `json:"lastLoginAt"`
	StrokeCount int64   `json:"strokeCount"`
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get(clientIPHeader); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
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
		counts := strokeCounts()
		out := make([]adminUser, len(users))
		for i, u := range users {
			out[i] = adminUser{u.ID, u.Email, u.Name, u.AvatarUrl, u.CreatedAt, u.LastLoginAt, counts[u.ID]}
		}
		c.JSON(http.StatusOK, out)
	}
}

// strokeCounts maps User id to the number of non-deleted Strokes. Stroke storage does not exist yet (ticket 13),
// so every User has none.
func strokeCounts() map[string]int64 { return nil }

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
