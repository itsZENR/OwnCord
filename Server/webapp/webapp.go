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
		_, _ = w.Write(indexHTML)
	})
	// Serve a real asset if it exists; otherwise SPA-fallback to index.html.
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/")
		if f, err := staticFS.Open(path); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
	return r
}
