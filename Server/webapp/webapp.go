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

// cspHeader is the Content-Security-Policy for the web client SPA.
// It is intentionally broader than the API/admin policy to support:
//   - WebAssembly (noise-suppression WASM, LiveKit codecs): wasm-unsafe-eval
//   - External images/link previews: img-src https: data: blob:
//   - Blob workers (audio worklets): worker-src blob:
//   - Cross-host WebSocket and media (LiveKit): connect-src wss:, media-src https: blob:
//   - Web fonts embedded as data URIs: font-src data:
const cspHeader = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; font-src 'self' data:"

// permissionsPolicyHeader grants camera, microphone, and display-capture to the
// origin itself, overriding the global middleware's empty (deny-all) policy.
// Geolocation is not granted.
const permissionsPolicyHeader = "camera=(self), microphone=(self), display-capture=(self)"

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
		w.Header().Set("Permissions-Policy", permissionsPolicyHeader)
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
		w.Header().Set("Permissions-Policy", permissionsPolicyHeader)
		_, _ = w.Write(indexHTML)
	})
	r.Get("/*", spaHandler)
	r.Head("/*", spaHandler)
	return r
}
