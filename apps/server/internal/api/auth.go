package api

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"

	"github.com/gin-gonic/gin"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
)

const identityKey = "identity"

type meUser struct {
	ID        string              `json:"id"`
	Email     string              `json:"email"`
	Name      *string             `json:"name"`
	AvatarURL *string             `json:"avatarUrl"`
	Status    auth.ApprovalStatus `json:"status"`
}

type meResponse struct {
	User *meUser `json:"user"`
	Role string  `json:"role"`
}

// requireRole resolves the session, renews it when due, and lets only the given roles through.
func requireRole(svc *auth.Service, roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		identity, renewed, err := svc.Authenticate(c.Request.Context(), c.Request)
		if err != nil {
			slog.Error("authenticate", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		if identity == nil {
			abortError(c, http.StatusUnauthorized, "unauthorized", "sign in required")
			return
		}
		if !slices.Contains(roles, identity.Role) {
			abortError(c, http.StatusForbidden, "forbidden", "not allowed")
			return
		}
		if renewed != nil {
			http.SetCookie(c.Writer, renewed)
		}
		c.Set(identityKey, identity)
		c.Next()
	}
}

// requireApproved runs after requireRole(RoleUser) and keeps Pending Users off the calendar endpoints.
func requireApproved(c *gin.Context) {
	if auth.ApprovalStatus(c.MustGet(identityKey).(*auth.Identity).User.Status) != auth.StatusApproved {
		abortError(c, http.StatusForbidden, "not_approved", "waiting for Admin approval")
		return
	}
	c.Next()
}

func startLogin(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		authURL, state, err := svc.BeginLogin(c.Query("return"))
		if errors.Is(err, auth.ErrInvalidReturn) {
			abortError(c, http.StatusBadRequest, "invalid_return", err.Error())
			return
		}
		if err != nil {
			slog.Error("begin login", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		http.SetCookie(c.Writer, state)
		c.Redirect(http.StatusFound, authURL)
	}
}

// finishLogin is a browser navigation, so failures redirect to the login page with a code instead of returning JSON.
func finishLogin(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		http.SetCookie(c.Writer, svc.ClearStateCookie())
		session, returnPath, err := svc.FinishLogin(c.Request.Context(), c.Request)
		if err != nil {
			code := auth.CodeSignInFailed
			if le := (*auth.LoginError)(nil); errors.As(err, &le) {
				code = le.Code
			}
			slog.Warn("sign-in failed", "code", code, "error", err)
			c.Redirect(http.StatusFound, "/login?error="+url.QueryEscape(code))
			return
		}
		http.SetCookie(c.Writer, session)
		c.Redirect(http.StatusFound, returnPath)
	}
}

func logout(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.Logout(c.Request.Context(), c.Request); err != nil {
			slog.Error("logout", "error", err)
			abortError(c, http.StatusInternalServerError, "internal", "internal error")
			return
		}
		http.SetCookie(c.Writer, svc.ClearSessionCookie())
		c.Status(http.StatusNoContent)
	}
}

func me(c *gin.Context) {
	identity := c.MustGet(identityKey).(*auth.Identity)
	res := meResponse{Role: identity.Role}
	if u := identity.User; u != nil {
		res.User = &meUser{ID: u.ID, Email: u.Email, Name: u.Name, AvatarURL: u.AvatarUrl, Status: auth.ApprovalStatus(u.Status)}
	}
	c.JSON(http.StatusOK, res)
}
