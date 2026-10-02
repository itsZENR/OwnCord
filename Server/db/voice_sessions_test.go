package db_test

import (
	"testing"

	"github.com/owncord/server/db"
)

func TestVoiceSessionSurvivesFirstParticipantLeaving(t *testing.T) {
	d := newVoiceTestDB(t)
	a, b := seedVoiceUser(t, d, "first"), seedVoiceUser(t, d, "second")
	ch := seedVoiceChannel(t, d, "lobby")
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	state := func(user int64) db.VoiceState {
		t.Helper()
		vs, err := d.GetVoiceState(user)
		must(err)
		if vs == nil {
			t.Fatal("missing voice state")
		}
		return *vs
	}
	must(d.JoinVoiceChannel(a, ch))
	first := state(a)
	if first.JoinedAt == 0 || first.JoinedAt != first.ChannelStartedAt || first.ServerTime < first.JoinedAt {
		t.Fatalf("first join timestamps = %+v", first)
	}
	// Seed a session two hours old without sleeps or changing the lifetime clock.
	start := first.JoinedAt - 7200
	_, err := d.Exec(`UPDATE voice_states SET joined_at = datetime(?, 'unixepoch') WHERE user_id = ?`, start, a)
	must(err)
	_, err = d.Exec(`UPDATE voice_channel_sessions SET started_at = ? WHERE channel_id = ?`, start, ch)
	must(err)
	must(d.JoinVoiceChannel(b, ch))
	second := state(b)
	if second.ChannelStartedAt != start || second.JoinedAt < first.JoinedAt {
		t.Fatalf("second participant must have an independent start = %+v", second)
	}
	must(d.LeaveVoiceChannel(a))
	must(d.UpdateVoiceMute(b, true))
	must(d.UpdateVoiceDeafen(b, true))
	must(d.UpdateVoiceCamera(b, true))
	must(d.UpdateVoiceScreenshare(b, true))
	must(d.CheckpointVoiceActivity())
	for _, read := range []func() ([]db.VoiceState, error){
		func() ([]db.VoiceState, error) { return d.GetChannelVoiceStates(ch) },
		d.GetAllVoiceStates,
	} {
		rows, err := read()
		must(err)
		if len(rows) != 1 || rows[0].ChannelStartedAt != start || rows[0].JoinedAt != second.JoinedAt || rows[0].ServerTime < second.ServerTime {
			t.Fatalf("session changed after first participant left or state update: %+v", rows)
		}
	}
	if got := state(b); got.ChannelStartedAt != start || got.JoinedAt != second.JoinedAt {
		t.Fatalf("single state timestamps = %+v", got)
	}
	must(d.LeaveVoiceChannel(b))
	must(d.JoinVoiceChannel(a, ch))
	if got := state(a); got.ChannelStartedAt <= start || got.ChannelStartedAt != got.JoinedAt {
		t.Fatalf("empty channel must start a fresh session: %+v", got)
	}
	if got := activityFor(t, d, a); got.Sessions != 2 {
		t.Fatalf("lifetime statistics must survive session reset: %+v", got)
	}
	must(d.ClearAllVoiceStates())
	// A stale shared start must not survive server startup cleanup.
	_, err = d.Exec(`INSERT INTO voice_channel_sessions(channel_id, started_at) VALUES(?, 1)`, ch)
	must(err)
}

func TestVoiceSessionChannelSwitchKeepsOtherParticipantsSession(t *testing.T) {
	d := newVoiceTestDB(t)
	u, other := seedVoiceUser(t, d, "switcher"), seedVoiceUser(t, d, "remaining")
	a, b := seedVoiceChannel(t, d, "one"), seedVoiceChannel(t, d, "two")
	for _, user := range []int64{u, other} {
		if err := d.JoinVoiceChannel(user, a); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.Exec(`UPDATE voice_channel_sessions SET started_at = 100 WHERE channel_id = ?`, a); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`UPDATE voice_states SET joined_at = datetime(200, 'unixepoch')`); err != nil {
		t.Fatal(err)
	}
	if err := d.JoinVoiceChannel(u, b); err != nil {
		t.Fatal(err)
	}
	remaining, err := d.GetVoiceState(other)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := d.GetVoiceState(u)
	if err != nil {
		t.Fatal(err)
	}
	if remaining.ChannelStartedAt != 100 || remaining.JoinedAt != 200 || moved.JoinedAt <= 200 || moved.JoinedAt != moved.ChannelStartedAt {
		t.Fatalf("switch changed wrong session: remaining=%+v moved=%+v", remaining, moved)
	}
}
