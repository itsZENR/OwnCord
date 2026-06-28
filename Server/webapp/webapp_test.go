package webapp_test

import (
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
