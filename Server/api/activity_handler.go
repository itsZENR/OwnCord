package api

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/owncord/server/db"
)

type voiceActivityResponse struct {
	UserID         int64            `json:"user_id"`
	TotalSeconds   int64            `json:"total_seconds"`
	Sessions       int64            `json:"sessions"`
	ChannelSeconds map[string]int64 `json:"channel_seconds,omitempty"`
}

func handleVoiceActivity(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		activity, err := database.GetVoiceActivity()
		if err != nil {
			slog.Error("read voice activity", "err", err)
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "INTERNAL", Message: "failed to load voice activity"})
			return
		}
		channelActivity, err := database.GetVoiceChannelActivity()
		if err != nil {
			slog.Error("read per-channel voice activity", "err", err)
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "INTERNAL", Message: "failed to load channel voice activity"})
			return
		}
		byUser := make(map[int64]map[string]int64)
		for _, item := range channelActivity {
			if byUser[item.UserID] == nil {
				byUser[item.UserID] = make(map[string]int64)
			}
			byUser[item.UserID][formatChannelID(item.ChannelID)] = item.TotalSeconds
		}
		members := make([]voiceActivityResponse, 0, len(activity))
		for _, item := range activity {
			members = append(members, voiceActivityResponse{
				UserID: item.UserID, TotalSeconds: item.TotalSeconds, Sessions: item.Sessions,
				ChannelSeconds: byUser[item.UserID],
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"members": members})
	}
}

func formatChannelID(id int64) string {
	return strconv.FormatInt(id, 10)
}
