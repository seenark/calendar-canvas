package api

import (
	"log/slog"
	"mime"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const maxBodyBytes = 2 << 20

func logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if c.Request.URL.Path == healthPath {
			return
		}
		slog.Info("request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration", time.Since(start),
		)
	}
}

// bodyLimit rejects oversized bodies up front and caps chunked ones while they are read.
func bodyLimit(c *gin.Context) {
	if c.Request.ContentLength > maxBodyBytes {
		abortError(c, http.StatusRequestEntityTooLarge, "payload_too_large", "request body is too large")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	c.Next()
}

func noStoreAPI(c *gin.Context) {
	if isAPIPath(c.Request.URL.Path) {
		c.Header("Cache-Control", "no-store")
	}
	c.Next()
}

// csrf requires the app's own Origin on every non-GET request and a JSON Content-Type on every request with a body.
func csrf(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}
		if c.GetHeader("Origin") != origin {
			abortError(c, http.StatusForbidden, "forbidden_origin", "request origin is not allowed")
			return
		}
		if c.Request.ContentLength != 0 {
			if mt, _, err := mime.ParseMediaType(c.GetHeader("Content-Type")); err != nil || mt != "application/json" {
				abortError(c, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json")
				return
			}
		}
		c.Next()
	}
}
