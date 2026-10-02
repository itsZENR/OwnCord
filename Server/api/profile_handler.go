package api

import (
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/owncord/server/auth"
	"github.com/owncord/server/db"
	"github.com/owncord/server/storage"
)

type profileBroadcaster interface {
	BroadcastProfileUpdate(userID int64, username, avatar string)
}

type updateProfileRequest struct {
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
}

type profileResponse struct {
	ID       int64   `json:"id"`
	Username string  `json:"username"`
	Avatar   *string `json:"avatar"`
	Role     string  `json:"role"`
	Status   string  `json:"status"`
}

// MountProfileRoutes registers the authenticated public-profile editor.
func MountProfileRoutes(r chi.Router, database *db.DB, store *storage.Storage, broadcaster profileBroadcaster) {
	r.With(AuthMiddleware(database)).Patch("/api/v1/users/me", handleUpdateProfile(database, store, broadcaster))
}

func handleUpdateProfile(database *db.DB, store *storage.Storage, broadcaster profileBroadcaster) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := r.Context().Value(UserKey).(*db.User)
		if !ok || user == nil {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "UNAUTHORIZED", Message: "not authenticated"})
			return
		}
		var req updateProfileRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "INVALID_INPUT", Message: "invalid profile data"})
			return
		}
		if req.Username == nil && req.Avatar == nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "INVALID_INPUT", Message: "nothing to update"})
			return
		}

		username := user.Username
		if req.Username != nil {
			username = strings.TrimSpace(*req.Username)
			if err := auth.ValidateUsername(username); err != nil {
				writeJSON(w, http.StatusBadRequest, errorResponse{Error: "INVALID_INPUT", Message: err.Error()})
				return
			}
		}
		if req.Avatar != nil && *req.Avatar != "" {
			if err := validateAvatar(database, store, *req.Avatar); err != nil {
				writeJSON(w, http.StatusBadRequest, errorResponse{Error: "INVALID_AVATAR", Message: err.Error()})
				return
			}
		}

		updated, err := database.UpdateUserProfile(user.ID, username, req.Avatar)
		if err != nil {
			if db.IsUniqueConstraintError(err) {
				writeJSON(w, http.StatusConflict, errorResponse{Error: "USERNAME_TAKEN", Message: "username already in use"})
				return
			}
			slog.Error("profile update failed", "user_id", user.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "SERVER_ERROR", Message: "failed to update profile"})
			return
		}
		role, err := database.GetRoleByID(updated.RoleID)
		if err != nil || role == nil {
			slog.Error("profile role lookup failed", "user_id", user.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "SERVER_ERROR", Message: "failed to load profile"})
			return
		}
		avatar := ""
		if updated.Avatar != nil {
			avatar = *updated.Avatar
		}
		broadcaster.BroadcastProfileUpdate(user.ID, updated.Username, avatar)
		_ = database.LogAudit(user.ID, "profile_update", "user", user.ID, "public profile updated")
		writeJSON(w, http.StatusOK, profileResponse{
			ID: updated.ID, Username: updated.Username, Avatar: updated.Avatar,
			Role: strings.ToLower(role.Name), Status: updated.Status,
		})
	}
}

func validateAvatar(database *db.DB, store *storage.Storage, avatar string) error {
	const prefix = "/api/v1/files/"
	if store == nil || !strings.HasPrefix(avatar, prefix) {
		return avatarError("upload an image to this server first")
	}
	id := strings.TrimPrefix(avatar, prefix)
	if _, err := uuid.Parse(id); err != nil || strings.Contains(id, "/") {
		return avatarError("invalid avatar image")
	}
	attachment, err := database.GetAttachmentByID(id)
	if err != nil || attachment == nil || attachment.Size > 512<<10 || attachment.Size <= 0 ||
		(attachment.MimeType != "image/png" && attachment.MimeType != "image/jpeg") {
		return avatarError("choose a PNG or JPEG image smaller than 512 KB")
	}
	file, err := store.Open(attachment.StoredAs)
	if err != nil {
		return avatarError("avatar image is unavailable")
	}
	defer file.Close() //nolint:errcheck
	config, format, err := image.DecodeConfig(file)
	if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 ||
		config.Width > 1024 || config.Height > 1024 {
		return avatarError("avatar dimensions must be at most 1024 × 1024 pixels")
	}
	return nil
}

type avatarError string

func (e avatarError) Error() string { return string(e) }
