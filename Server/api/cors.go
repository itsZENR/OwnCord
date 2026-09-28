package api

import "net/http"

// corsMiddleware allows the browser development client to call the HTTPS API
// from Vite (http://localhost:1420 or http://127.0.0.1:1420). Production
// deployments can restrict this with server.allowed_origins.
func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := origin == "" || isOriginAllowed(r, allowedOrigins)
			if origin != "" && allowed {
				// Echo the concrete origin rather than '*', which keeps the
				// response safe if credentials are added to a future client.
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
			}
			if r.Method == http.MethodOptions {
				if !allowed {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
