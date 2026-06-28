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

// wantCSP is the SPA Content-Security-Policy expected on all index responses.
// It is broader than the API/admin policy to support WebAssembly, blob workers,
// external images, cross-host WebSocket/media, and data-URI fonts.
const wantCSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; font-src 'self' data:"

// wantPermissionsPolicy is the Permissions-Policy expected on all index responses.
// It grants camera, microphone, and display-capture to the origin itself so that
// voice, video, and screenshare work. Geolocation is not granted.
const wantPermissionsPolicy = "camera=(self), microphone=(self), display-capture=(self)"

// TestIndexResponseHasCSPHeader ensures the root index response sets the
// Content-Security-Policy header matching the SPA-specific policy.
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
	if csp != wantCSP {
		t.Fatalf("CSP = %q, want %q", csp, wantCSP)
	}
}

// TestIndexResponseHasPermissionsPolicy ensures GET / grants camera and
// microphone to the origin (not the empty deny-all policy from the global
// security-headers middleware).
func TestIndexResponseHasPermissionsPolicy(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	defer resp.Body.Close()
	pp := resp.Header.Get("Permissions-Policy")
	if pp == "" {
		t.Fatal("Permissions-Policy header missing on GET /")
	}
	if pp != wantPermissionsPolicy {
		t.Fatalf("Permissions-Policy = %q, want %q", pp, wantPermissionsPolicy)
	}
	// Explicitly assert grant direction: (self) not ().
	if !strings.Contains(pp, "camera=(self)") {
		t.Errorf("Permissions-Policy does not grant camera to self: %q", pp)
	}
	if !strings.Contains(pp, "microphone=(self)") {
		t.Errorf("Permissions-Policy does not grant microphone to self: %q", pp)
	}
}

// TestSPAFallbackHasCSPAndPermissionsPolicy ensures that deep SPA paths (which
// hit the /* fallback) also carry the correct CSP and Permissions-Policy.
func TestSPAFallbackHasCSPAndPermissionsPolicy(t *testing.T) {
	srv := httptest.NewServer(webapp.NewHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/channels/999")
	if err != nil {
		t.Fatalf("GET /channels/999: %v", err)
	}
	defer resp.Body.Close()

	csp := resp.Header.Get("Content-Security-Policy")
	if csp != wantCSP {
		t.Fatalf("SPA fallback CSP = %q, want %q", csp, wantCSP)
	}

	pp := resp.Header.Get("Permissions-Policy")
	if pp != wantPermissionsPolicy {
		t.Fatalf("SPA fallback Permissions-Policy = %q, want %q", pp, wantPermissionsPolicy)
	}
	if !strings.Contains(pp, "camera=(self)") {
		t.Errorf("SPA fallback Permissions-Policy does not grant camera to self: %q", pp)
	}
}
