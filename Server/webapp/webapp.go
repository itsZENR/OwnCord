// Package webapp serves the embedded OwnCord web client as an SPA.
package webapp

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

//go:embed dist
var staticFiles embed.FS

// cspHeader mirrors the Content-Security-Policy used by the admin panel so
// both surfaces share a consistent policy.
const cspHeader = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"

// NewHandler returns an http.Handler serving the embedded web client.
// Unknown paths fall back to index.html for client-side routing.
func NewHandler() http.Handler {
	staticFS, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		panic("webapp: failed to create static sub-FS: " + err.Error())
	}
	indexHTML, err := fs.ReadFile(staticFS, "index.html")
	if err != nil {
		panic("webapp: failed to read index.html: " + err.Error())
	}

	fileServer := http.FileServer(http.FS(staticFS))
	r := chi.NewRouter()
	r.Get("/", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", cspHeader)
		_, _ = w.Write(indexHTML)
	})
	// Serve a real asset if it exists and is not a directory; otherwise
	// SPA-fallback to index.html. Both GET and HEAD are registered explicitly
	// so that proxies and cache-checkers do not receive 405, while POST and
	// other methods are NOT caught here (the outer router's method-not-allowed
	// logic on routes such as /health must still function correctly).
	spaHandler := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/")
		if f, err := staticFS.Open(path); err == nil {
			stat, statErr := f.Stat()
			_ = f.Close()
			if statErr == nil && !stat.IsDir() {
				fileServer.ServeHTTP(w, req)
				return
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", cspHeader)
		_, _ = w.Write(indexHTML)
	})
	r.Get("/*", spaHandler)
	r.Head("/*", spaHandler)
	return r
}
