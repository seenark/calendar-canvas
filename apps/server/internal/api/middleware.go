package api

import (
	"log/slog"
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
