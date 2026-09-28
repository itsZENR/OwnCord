package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// Direct calls are ephemeral; membership is checked against the persisted DM.
// Each attempt has a unique media room so an old JWT cannot enter a later call.
type directCall struct {
	ID            string `json:"id"`
	ChannelID     int64  `json:"channel_id"`
	CallerID      int64  `json:"caller_id"`
	RecipientID   int64  `json:"recipient_id"`
	CallerName    string `json:"caller_name"`
	RecipientName string `json:"recipient_name"`
	State         string `json:"state"`
	Reason        string `json:"reason,omitempty"`
	ExpiresAt     int64  `json:"expires_at"`
}

func (call *directCall) room() string { return fmt.Sprintf("call-%d-%s", call.ChannelID, call.ID) }
func (h *Hub) sendCallState(call *directCall) {
	msg := buildJSON(map[string]any{"type": MsgTypeCallState, "payload": call})
	h.SendToUser(call.CallerID, msg)
	h.SendToUser(call.RecipientID, msg)
}

func registerCallHandlers(r *HandlerRegistry) {
	for _, name := range []string{"call_start", "call_accept", "call_end", "call_sync"} {
		kind := name
		r.Register(kind, func(ctx context.Context, h *Hub, c *Client, _ string, payload json.RawMessage) {
			h.handleDirectCall(ctx, c, kind, payload)
		})
	}
}

func (h *Hub) handleDirectCall(_ context.Context, c *Client, kind string, payload json.RawMessage) {
	h.callMu.Lock()
	defer h.callMu.Unlock()
	if kind == "call_sync" {
		if call := h.calls[c.userID]; call != nil {
			c.sendMsg(buildJSON(map[string]any{"type": MsgTypeCallState, "payload": call}))
			if call.State == "active" {
				h.sendCallToken(c, call)
			}
		}
		return
	}
	var p struct {
		ChannelID int64  `json:"channel_id"`
		ID        string `json:"id"`
	}
	if json.Unmarshal(payload, &p) != nil {
		c.sendMsg(buildErrorMsg(ErrCodeBadRequest, "invalid call payload"))
		return
	}
	if kind == "call_start" {
		if !h.limiter.Allow(fmt.Sprintf("call:%d", c.userID), 3, time.Minute) {
			c.sendMsg(buildRateLimitError("too many calls", 60))
			return
		}
		if h.livekit == nil || (h.lkProcess != nil && !h.lkProcess.IsRunning()) {
			c.sendMsg(buildErrorMsg(ErrCodeVoiceError, "voice is not configured or temporarily unavailable"))
			return
		}
		ids, err := h.db.GetDMParticipantIDs(p.ChannelID)
		ch, chErr := h.db.GetChannel(p.ChannelID)
		if err != nil || chErr != nil || ch == nil || ch.Type != "dm" || len(ids) != 2 || (ids[0] != c.userID && ids[1] != c.userID) {
			c.sendMsg(buildErrorMsg(ErrCodeForbidden, "not a participant of this DM"))
			return
		}
		targetID := ids[0]
		if targetID == c.userID {
			targetID = ids[1]
		}
		target := h.GetClient(targetID)
		if target == nil || target.user == nil {
			c.sendMsg(buildErrorMsg("CALL_OFFLINE", "recipient is offline"))
			return
		}
		if c.user == nil {
			return
		}
		if h.calls[c.userID] != nil || h.calls[targetID] != nil || c.getVoiceChID() != 0 || target.getVoiceChID() != 0 {
			c.sendMsg(buildErrorMsg("CALL_BUSY", "you or the recipient are already in voice or in another call"))
			return
		}
		call := &directCall{ID: uuid.NewString(), ChannelID: p.ChannelID, CallerID: c.userID,
			RecipientID: targetID, CallerName: c.user.Username, RecipientName: target.user.Username,
			State: "ringing", ExpiresAt: time.Now().Add(30 * time.Second).Unix()}
		h.calls[c.userID] = call
		h.calls[targetID] = call
		h.sendCallState(call)
		time.AfterFunc(30*time.Second, func() {
			h.callMu.Lock()
			defer h.callMu.Unlock()
			if h.calls[call.CallerID] == call && call.State == "ringing" {
				h.finishCallLocked(call, "missed")
			}
		})
		return
	}
	call := h.calls[c.userID]
	if call == nil || call.ID != p.ID {
		c.sendMsg(buildErrorMsg("CALL_EXPIRED", "call has ended"))
		return
	}
	if kind == "call_end" {
		reason := "ended"
		if call.State == "ringing" {
			if c.userID == call.RecipientID {
				reason = "declined"
			} else {
				reason = "cancelled"
			}
		}
		h.finishCallLocked(call, reason)
		return
	}
	if call.RecipientID != c.userID || call.State != "ringing" || time.Now().Unix() >= call.ExpiresAt {
		c.sendMsg(buildErrorMsg("CALL_EXPIRED", "call cannot be accepted"))
		return
	}
	caller := h.GetClient(call.CallerID)
	if caller == nil || caller.getVoiceChID() != 0 || c.getVoiceChID() != 0 {
		h.finishCallLocked(call, "busy")
		return
	}
	// Provision both participants before announcing acceptance. Roll back both
	// sides on any DB/token error so neither client is left in a phantom call.
	for _, peer := range []*Client{caller, c} {
		if err := h.db.JoinVoiceChannel(peer.userID, call.ChannelID); err != nil {
			slog.Error("direct call join", "err", err)
			h.finishCallLocked(call, "failed")
			return
		}
		peer.setVoiceChID(call.ChannelID)
	}
	call.State = "active"
	h.sendCallState(call)
	for _, peer := range []*Client{caller, c} {
		if !h.sendCallToken(peer, call) {
			h.finishCallLocked(call, "failed")
			return
		}
	}
	states, err := h.db.GetChannelVoiceStates(call.ChannelID)
	if err == nil {
		for _, state := range states {
			h.broadcastToDMParticipants(call.ChannelID, buildVoiceState(state))
		}
	}
}

// Caller holds callMu.
func (h *Hub) sendCallToken(c *Client, call *directCall) bool {
	if c.user == nil || h.livekit == nil {
		return false
	}
	token, err := h.livekit.generateRoomToken(c.userID, c.user.Username, call.room(), true, true, 2*time.Minute)
	if err != nil {
		slog.Error("direct call token", "err", err)
		return false
	}
	c.sendMsg(buildVoiceToken(call.ChannelID, token, "/livekit", h.livekit.URL()))
	c.sendMsg(buildVoiceConfig(call.ChannelID, "medium", 64000, 2))
	return true
}

func (h *Hub) finishCallLocked(call *directCall, reason string) {
	delete(h.calls, call.CallerID)
	delete(h.calls, call.RecipientID)
	call.State = "ended"
	call.Reason = reason
	for _, id := range []int64{call.CallerID, call.RecipientID} {
		if peer := h.GetClient(id); peer != nil && peer.getVoiceChID() == call.ChannelID {
			peer.clearVoiceChID()
		}
		if _, err := h.db.Exec(`DELETE FROM voice_states WHERE user_id = ? AND channel_id = ?`, id, call.ChannelID); err != nil {
			slog.Error("direct call cleanup", "err", err)
		}
		h.broadcastToDMParticipants(call.ChannelID, buildVoiceLeave(call.ChannelID, id))
		if h.livekit != nil {
			room := call.room()
			go func(userID int64) { _ = h.livekit.removeRoomParticipant(room, userID) }(id)
		}
	}
	h.sendCallState(call)
}

func (h *Hub) endDirectCall(userID int64, reason string) bool {
	h.callMu.Lock()
	defer h.callMu.Unlock()
	if call := h.calls[userID]; call != nil {
		h.finishCallLocked(call, reason)
		return true
	}
	return false
}

func (h *Hub) broadcastVoiceEvent(channelID int64, msg []byte) {
	ch, err := h.db.GetChannel(channelID)
	if err != nil || ch == nil {
		return
	}
	if ch.Type == "dm" {
		h.broadcastToDMParticipants(channelID, msg)
	} else {
		h.BroadcastToAll(msg)
	}
}
