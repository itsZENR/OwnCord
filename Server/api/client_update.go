// Package api provides the HTTP router and handlers for the OwnCord server.
//
// client_update.go serves Tauri-compatible update metadata so the desktop
// client can check for new versions and self-update.
package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/owncord/server/updater"
	"golang.org/x/mod/semver"
)

// tauriPlatformResponse is the per-platform entry in the Tauri updater JSON.
type tauriPlatformResponse struct {
	Signature string `json:"signature"`
	URL       string `json:"url"`
}

// tauriUpdateResponse is the JSON shape the Tauri updater plugin expects.
type tauriUpdateResponse struct {
	Version   string                          `json:"version"`
	Notes     string                          `json:"notes,omitempty"`
	PubDate   string                          `json:"pub_date,omitempty"`
	Platforms map[string]tauriPlatformResponse `json:"platforms"`
}

// MountClientUpdateRoute adds the unauthenticated client-update endpoint.
// The route is outside the auth middleware because the client needs to check
// for updates before (or without) logging in.
func MountClientUpdateRoute(r chi.Router, u *updater.Updater) {
	r.Get("/api/v1/client-update/{target}/{current_version}", handleClientUpdate(u))
}

func handleClientUpdate(u *updater.Updater) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		target := chi.URLParam(r, "target")
		currentVersion := chi.URLParam(r, "current_version")

		if target == "" || currentVersion == "" {
			http.Error(w, "missing target or current_version", http.StatusBadRequest)
			return
		}

		info, err := u.CheckForUpdate(r.Context())
		if err != nil {
			http.Error(w, "failed to check for updates", http.StatusBadGateway)
			return
		}

		// Compare versions — return 204 if no update available.
		cv := ensureV(currentVersion)
		lv := ensureV(info.Latest)
		if semver.Compare(cv, lv) >= 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Find the .nsis.zip and .nsis.zip.sig assets from the release.
		clientAssets := u.FindClientAssets()
		nsisURL := clientAssets.InstallerURL
		sigURL := clientAssets.SignatureURL
		if nsisURL == "" || sigURL == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Fetch the signature file content (small text file).
		sigContent, err := u.FetchTextAsset(r.Context(), sigURL)
		if err != nil {
			http.Error(w, "failed to fetch signature", http.StatusBadGateway)
			return
		}

		// The Tauri updater looks up its own target key in `platforms` — for a
		// Windows x64 NSIS build that is "windows-x86_64-nsis" (and it falls
		// back to "windows-x86_64"). It does NOT necessarily request with that
		// exact string in the URL (observed: it requests target "windows"), so
		// keying the response only by the requested target makes the updater
		// report "none of the fallback platforms were found". Publish all the
		// keys it may look for, plus the requested target for good measure.
		entry := tauriPlatformResponse{
			Signature: strings.TrimSpace(sigContent),
			URL:       nsisURL,
		}
		platforms := map[string]tauriPlatformResponse{
			"windows-x86_64":      entry,
			"windows-x86_64-nsis": entry,
		}
		if target != "" {
			platforms[target] = entry
		}

		resp := tauriUpdateResponse{
			Version:   strings.TrimPrefix(info.Latest, "v"),
			Notes:     info.ReleaseNotes,
			Platforms: platforms,
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

// ensureV returns a version string with a "v" prefix for semver comparison.
func ensureV(v string) string {
	if strings.HasPrefix(v, "v") {
		return v
	}
	return "v" + v
}
