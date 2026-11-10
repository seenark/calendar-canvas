package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func newTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return NewRouter(fstest.MapFS{
		"index.html":             {Data: []byte("<html>app</html>")},
		"sw.js":                  {Data: []byte("sw")},
		"manifest.webmanifest":   {Data: []byte("{}")},
		"favicon.svg":            {Data: []byte("<svg/>")},
		"assets/index-abc123.js": {Data: []byte("console.log(1)")},
	})
}

func do(r http.Handler, method, target string, body io.Reader) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, target, body))
	return w
}

func TestHealth(t *testing.T) {
	w := do(newTestRouter(), http.MethodGet, "/api/health", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func TestSPAFallbackForDeepLinks(t *testing.T) {
	r := newTestRouter()
	for _, target := range []string{"/", "/d/2026-03-14", "/m/2026-03", "/assets", "/assets/missing.js"} {
		w := do(r, http.MethodGet, target, nil)
		if w.Code != http.StatusOK || w.Body.String() != "<html>app</html>" {
			t.Errorf("%s: status %d body %q, want index.html", target, w.Code, w.Body.String())
		}
		if got := w.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("%s: Cache-Control = %q, want no-cache", target, got)
		}
	}
}

func TestExistingFilesAreServedNotFallback(t *testing.T) {
	w := do(newTestRouter(), http.MethodGet, "/favicon.svg", nil)
	if w.Code != http.StatusOK || w.Body.String() != "<svg/>" {
		t.Fatalf("status %d body %q, want favicon", w.Code, w.Body.String())
	}
}

func TestUnknownAPIReturnsErrorEnvelope(t *testing.T) {
	r := newTestRouter()
	for _, target := range []string{"/api/nope", "/api/days/2026-03-14/strokes", "/api"} {
		w := do(r, http.MethodGet, target, nil)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", target, w.Code)
		}
		var env struct {
			Error struct{ Code, Message string }
		}
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("%s: body is not JSON: %v", target, err)
		}
		if env.Error.Code != "not_found" || env.Error.Message == "" {
			t.Errorf("%s: envelope = %+v", target, env)
		}
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", target, got)
		}
	}
}

func TestNonGETOutsideAPIIsNotFound(t *testing.T) {
	w := do(newTestRouter(), http.MethodPost, "/d/2026-03-14", strings.NewReader("x"))
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestCacheHeadersPerPath(t *testing.T) {
	r := newTestRouter()
	tests := map[string]string{
		"/sw.js":                  "no-cache",
		"/manifest.webmanifest":   "no-cache",
		"/assets/index-abc123.js": "public, max-age=31536000, immutable",
		"/api/health":             "no-store",
		"/favicon.svg":            "",
	}
	for target, want := range tests {
		if got := do(r, http.MethodGet, target, nil).Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control = %q, want %q", target, got, want)
		}
	}
}

func TestIndexHTMLRedirectsToRoot(t *testing.T) {
	w := do(newTestRouter(), http.MethodGet, "/index.html", nil)
	if w.Code != http.StatusMovedPermanently {
		t.Fatalf("status = %d, want 301", w.Code)
	}
	if got := w.Header().Get("Location"); got != "./" {
		t.Errorf("Location = %q, want ./", got)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
}

func TestStaticServingStaysInsideFS(t *testing.T) {
	r := newTestRouter()
	tests := []struct{ target, body string }{
		{"/../sw.js", "sw"},
		{"/assets/../../sw.js", "sw"},
		{"/%2e%2e/sw.js", "sw"},
		{"/assets/../../etc/passwd", "<html>app</html>"},
		{"/assets/", "<html>app</html>"},
		{"/assets/..", "<html>app</html>"},
	}
	for _, tt := range tests {
		w := do(r, http.MethodGet, tt.target, nil)
		if w.Code != http.StatusOK || w.Body.String() != tt.body {
			t.Errorf("%s: status %d body %q, want 200 %q", tt.target, w.Code, w.Body.String(), tt.body)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	r := newTestRouter()
	var readErr error
	r.POST("/api/echo", func(c *gin.Context) {
		_, readErr = io.Copy(io.Discard, c.Request.Body)
		c.Status(http.StatusNoContent)
	})

	big := strings.Repeat("a", maxBodyBytes+1)

	w := do(r, http.MethodPost, "/api/echo", strings.NewReader(big))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("declared length: status = %d, want 413", w.Code)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("413 Cache-Control = %q, want no-store", got)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/echo", io.NopCloser(strings.NewReader(big)))
	req.ContentLength = -1
	r.ServeHTTP(httptest.NewRecorder(), req)
	if readErr == nil {
		t.Error("chunked body over the cap was fully read")
	}

	readErr = nil
	if w := do(r, http.MethodPost, "/api/echo", strings.NewReader("ok")); w.Code != http.StatusNoContent || readErr != nil {
		t.Errorf("small body: status %d err %v", w.Code, readErr)
	}
}
