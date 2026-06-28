package webapp_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/owncord/server/webapp"
)

func TestNewHandlerServesIndex(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		t.Fatalf("content-type = %q, want text/html", ct)
	}
}

func TestUnknownPathFallsBackToIndex(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/channels/123")
	if err != nil {
		t.Fatalf("GET deep link: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (SPA fallback)", resp.StatusCode)
	}
}

// TestHeadRootReturns200 ensures HEAD / is handled (not 405).
func TestHeadRootReturns200(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodHead, srv.URL+"/", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("HEAD /: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("HEAD / status = %d, want 200", resp.StatusCode)
	}
}

// TestDirectoryPathReturnsSPAFallback ensures that a path which could map to a
// directory (or simply does not exist as a file) returns the index.html
// SPA fallback rather than a directory listing.
func TestDirectoryPathReturnsSPAFallback(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/assets")
	if err != nil {
		t.Fatalf("GET /assets: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (SPA fallback)", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		t.Fatalf("content-type = %q, want text/html", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "OwnCord") {
		t.Fatalf("body does not contain index.html marker 'OwnCord': %s", body)
	}
}

// TestIndexResponseHasCSPHeader ensures the root index response sets the
// Content-Security-Policy header matching the admin panel policy.
func TestIndexResponseHasCSPHeader(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	defer resp.Body.Close()
	csp := resp.Header.Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("Content-Security-Policy header missing on GET /")
	}
	const want = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
	if csp != want {
		t.Fatalf("CSP = %q, want %q", csp, want)
	}
}
