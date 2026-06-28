package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/owncord/server/api"
	"github.com/owncord/server/config"
	"github.com/owncord/server/db"
)

// setupRouter creates a test router with an in-memory database.
func setupRouter(t *testing.T) http.Handler {
	t.Helper()

	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open error: %v", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatalf("db.Migrate error: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	cfg := &config.Config{
		Server: config.ServerConfig{
			Name: "Test Server",
			Port: 8443,
		},
	}

	handler, _, cleanup := api.NewRouter(cfg, database, "test", nil)
	t.Cleanup(cleanup)
	return handler
}

func TestHealthEndpointReturns200(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /health status = %d, want 200", rec.Code)
	}
}

func TestHealthEndpointReturnsJSON(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", contentType)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
}

func TestHealthEndpointStatusOK(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("status = %v, want 'ok'", body["status"])
	}
}

func TestHealthEndpointHasVersion(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}

	if body["version"] == nil || body["version"] == "" {
		t.Error("health response missing 'version' field")
	}
}

func TestAPIV1InfoEndpoint(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/info", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /api/v1/info status = %d, want 200", rec.Code)
	}
}

func TestAPIV1InfoReturnsServerName(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/info", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}

	if body["name"] != "Test Server" {
		t.Errorf("name = %v, want 'Test Server'", body["name"])
	}
}

func TestAPIV1InfoReturnsVersion(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/info", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}

	if body["version"] == nil {
		t.Error("info response missing 'version' field")
	}
}

func TestUnknownRouteReturns404(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nonexistent", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/v1/nonexistent status = %d, want 404", rec.Code)
	}
}

func TestRequestIDMiddleware(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	// Request ID header should be set by middleware.
	requestID := rec.Header().Get("X-Request-Id")
	if requestID == "" {
		t.Error("X-Request-Id header not set by middleware")
	}
}

func TestHealthMethodNotAllowed(t *testing.T) {
	router := setupRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /health status = %d, want 405", rec.Code)
	}
}

// TestWebClientHeadersOverrideMiddleware verifies that the SPA handler's
// Permissions-Policy and Content-Security-Policy headers take precedence over
// the values set by the global SecurityHeaders middleware.
//
// The middleware sets:
//   - Permissions-Policy: camera=(), microphone=(), geolocation=()  (deny all)
//   - Content-Security-Policy: default-src 'self'
//
// The webapp handler must override both so that voice/video/screenshare work
// and the rich client's WASM + blob + cross-host requirements are met.
func TestWebClientHeadersOverrideMiddleware(t *testing.T) {
	router := setupRouter(t)

	for _, path := range []string{"/", "/channels/123"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			// Permissions-Policy must grant self, not deny with empty allowlist.
			pp := rec.Header().Get("Permissions-Policy")
			if pp == "" {
				t.Fatal("Permissions-Policy header missing")
			}
			if !strings.Contains(pp, "camera=(self)") {
				t.Errorf("Permissions-Policy does not grant camera=(self), got: %q", pp)
			}
			if !strings.Contains(pp, "microphone=(self)") {
				t.Errorf("Permissions-Policy does not grant microphone=(self), got: %q", pp)
			}
			// The middleware's deny-all value must NOT be present.
			if strings.Contains(pp, "camera=()") {
				t.Errorf("Permissions-Policy still contains middleware deny-all camera=(): %q", pp)
			}

			// CSP must be the SPA-specific policy, not the bare default-src 'self'.
			csp := rec.Header().Get("Content-Security-Policy")
			if !strings.Contains(csp, "'wasm-unsafe-eval'") {
				t.Errorf("CSP missing wasm-unsafe-eval (WASM blocked): %q", csp)
			}
			if !strings.Contains(csp, "img-src") || !strings.Contains(csp, "https:") {
				t.Errorf("CSP missing img-src https: (external images blocked): %q", csp)
			}
			// The bare middleware fallback policy must NOT be present.
			if csp == "default-src 'self'" {
				t.Errorf("CSP is the bare middleware policy, handler override did not take effect")
			}
		})
	}
}
