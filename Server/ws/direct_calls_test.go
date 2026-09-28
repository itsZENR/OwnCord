package ws

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/owncord/server/auth"
	"github.com/owncord/server/config"
	"github.com/owncord/server/db"
	"github.com/owncord/server/permissions"
)

func callFixture(t *testing.T) (*Hub, []*Client, int64) {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	lk, err := NewLiveKitClient(&config.VoiceConfig{LiveKitAPIKey: "test-call-key", LiveKitAPISecret: "test-call-secret-abcdefghijklmnopqrstuvwxyz", LiveKitURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	h := NewHub(d, auth.NewRateLimiter())
	h.SetLiveKit(lk)
	clients := []*Client{}
	for _, name := range []string{"caller", "recipient", "outsider"} {
		id, err := d.CreateUser(name, "hash", 4)
		if err != nil {
			t.Fatal(err)
		}
		user, err := d.GetUserByID(id)
		if err != nil {
			t.Fatal(err)
		}
		c := newClient(h, nil, user, "", context.Background())
		h.registerNow(c)
		clients = append(clients, c)
	}
	channel, _, err := d.GetOrCreateDMChannel(clients[0].userID, clients[1].userID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		h.callMu.Lock()
		h.calls = make(map[int64]*directCall)
		h.callMu.Unlock()
		server.Close()
		_ = d.Close()
	})
	return h, clients, channel.ID
}

func callMessage(h *Hub, c *Client, kind string, payload any) {
	raw, _ := json.Marshal(map[string]any{"type": kind, "payload": payload})
	h.handleMessage(c, raw)
}

func callEvent(t *testing.T, c *Client, kind string) map[string]any {
	t.Helper()
	for {
		select {
		case raw := <-c.send:
			var event struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			}
			if err := json.Unmarshal(raw, &event); err != nil {
				t.Fatal(err)
			}
			if event.Type == kind {
				return event.Payload
			}
		default:
			t.Fatalf("missing %s event", kind)
			return nil
		}
	}
}

func TestDirectCallConsentPrivacyAndFreshRooms(t *testing.T) {
	h, peers, ch := callFixture(t)
	a, b, outsider := peers[0], peers[1], peers[2]
	callMessage(h, outsider, "call_start", map[string]any{"channel_id": ch})
	if e := callEvent(t, outsider, "error"); e["code"] != "FORBIDDEN" {
		t.Fatal(e)
	}
	callMessage(h, a, "voice_join", map[string]any{"channel_id": ch})
	callEvent(t, a, "error")
	callMessage(h, a, "call_start", map[string]any{"channel_id": ch})
	ring := callEvent(t, a, "call_state")
	id := ring["id"].(string)
	if a.getVoiceChID() != 0 || b.getVoiceChID() != 0 {
		t.Fatal("joined before consent")
	}
	callMessage(h, a, "call_accept", map[string]any{"id": id})
	callEvent(t, a, "error")
	callMessage(h, outsider, "call_accept", map[string]any{"id": id})
	callEvent(t, outsider, "error")
	callMessage(h, b, "call_accept", map[string]any{"id": id})
	if a.getVoiceChID() != ch || b.getVoiceChID() != ch {
		t.Fatal("accepted peers not joined")
	}
	token := callEvent(t, a, "voice_token")["token"].(string)
	claimsRaw, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		Video struct {
			Room string `json:"room"`
		} `json:"video"`
	}
	if err := json.Unmarshal(claimsRaw, &claims); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(claims.Video.Room, id) {
		t.Fatal("private room is reused across attempts")
	}
	if len(outsider.send) != 0 {
		t.Fatal("call leaked to outsider")
	}
	ready, err := h.buildReady(h.db, outsider.userID)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot struct {
		Payload struct {
			States []db.VoiceState `json:"voice_states"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(ready, &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Payload.States) != 0 {
		t.Fatal("private voice state leaked in ready")
	}
	if h.hasChannelPerm(b, ch, permissions.ManageMessages) {
		t.Fatal("DM call permission grants moderation")
	}
	callMessage(h, a, "call_end", map[string]any{"id": id})
	if a.getVoiceChID() != 0 || b.getVoiceChID() != 0 || len(h.calls) != 0 {
		t.Fatal("call not fully cleaned")
	}
	states, err := h.db.GetAllVoiceStates()
	if err != nil || len(states) != 0 {
		t.Fatalf("ghost state: %v %v", states, err)
	}
	activity, err := h.db.GetVoiceActivity()
	if err != nil || len(activity) != 0 {
		t.Fatal("private call counted toward achievements")
	}
}

func TestDirectCallBusyExpiredAndDisconnect(t *testing.T) {
	h, peers, ch := callFixture(t)
	a, b := peers[0], peers[1]
	b.setVoiceChID(999)
	callMessage(h, a, "call_start", map[string]any{"channel_id": ch})
	if e := callEvent(t, a, "error"); e["code"] != "CALL_BUSY" {
		t.Fatal(e)
	}
	b.clearVoiceChID()
	callMessage(h, a, "call_start", map[string]any{"channel_id": ch})
	id := callEvent(t, a, "call_state")["id"].(string)
	h.calls[a.userID].ExpiresAt = time.Now().Add(-time.Second).Unix()
	callMessage(h, b, "call_accept", map[string]any{"id": id})
	if e := callEvent(t, b, "error"); e["code"] != "CALL_EXPIRED" {
		t.Fatal(e)
	}
	h.handleVoiceLeave(context.Background(), a)
	if len(h.calls) != 0 {
		t.Fatal("ringing call survived disconnect")
	}
	h.unregisterNow(b)
	callMessage(h, a, "call_start", map[string]any{"channel_id": ch})
	if e := callEvent(t, a, "error"); e["code"] != "CALL_OFFLINE" {
		t.Fatal(e)
	}
}
