package api

import (
	"database/sql"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/config"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const healthPath = "/api/health"

const (
	cacheRevalidate = "no-cache"
	cacheImmutable  = "public, max-age=31536000, immutable"
)

func NewRouter(spa fs.FS, cfg config.Config, svc *auth.Service, conn *sql.DB) *gin.Engine {
	r := gin.New()
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	r.Use(logger(), gin.Recovery(), noStoreAPI, bodyLimit)

	r.GET(healthPath, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api", csrf(cfg.AppBaseURL))
	api.GET("/auth/google/start", startLogin(svc))
	api.GET("/auth/google/callback", finishLogin(svc))
	signedIn := requireRole(svc, auth.RoleUser, auth.RoleAdmin)
	api.POST("/auth/logout", signedIn, logout(svc))
	api.GET("/me", signedIn, me)

	strokes := newStrokeHandlers(conn)
	calendar := api.Group("", requireRole(svc, auth.RoleUser), requireApproved)
	calendar.GET("/months/:month", strokes.month)
	calendar.POST("/strokes/ops", strokes.ops)
	calendar.POST("/days/:date/prune", strokes.prune)

	q := store.New(conn)
	api.POST("/admin/login", adminLogin(svc))
	admin := api.Group("/admin", requireRole(svc, auth.RoleAdmin))
	admin.GET("/users", listUsers(q))
	admin.PATCH("/users/:id", setUserStatus(q))
	admin.DELETE("/users/:id", deleteUser(q))

	r.NoRoute(serveSPA(spa))
	return r
}

func isAPIPath(p string) bool {
	return p == "/api" || strings.HasPrefix(p, "/api/")
}

func serveSPA(spa fs.FS) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if isAPIPath(p) {
			abortError(c, http.StatusNotFound, "not_found", "no such API endpoint")
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			abortError(c, http.StatusNotFound, "not_found", "not found")
			return
		}

		name := path.Clean("/" + p)[1:]
		if info, err := fs.Stat(spa, name); name != "" && err == nil && !info.IsDir() {
			if cc := fileCacheControl(name); cc != "" {
				c.Header("Cache-Control", cc)
			}
			http.ServeFileFS(c.Writer, c.Request, spa, name)
			return
		}

		index, err := fs.ReadFile(spa, "index.html")
		if err != nil {
			abortError(c, http.StatusNotFound, "not_found", "not found")
			return
		}
		c.Header("Cache-Control", cacheRevalidate)
		c.Data(http.StatusOK, "text/html; charset=utf-8", index)
	}
}

func fileCacheControl(name string) string {
	switch {
	case strings.HasPrefix(name, "assets/"):
		return cacheImmutable
	case name == "sw.js", name == "index.html", name == "manifest.webmanifest", name == "admin.webmanifest":
		return cacheRevalidate
	}
	return ""
}
