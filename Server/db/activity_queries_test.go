package db_test

import (
	"github.com/owncord/server/db"
	"testing"
)

func activityFor(t *testing.T, d *db.DB, user int64) db.VoiceActivity {
	t.Helper()
	items, err := d.GetVoiceActivity()
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.UserID == user {
			return item
		}
	}
	return db.VoiceActivity{}
}

func TestActivityAccumulatesSwitchesAndLeavesExactlyOnce(t *testing.T) {
	d := newVoiceTestDB(t)
	u := seedVoiceUser(t, d, "activity_user")
	a, err := d.CreateChannel("one", "voice", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.CreateChannel("two", "voice", "", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.JoinVoiceChannel(u, a); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`UPDATE voice_activity_clock SET accounted_at = unixepoch() - 3600 WHERE user_id = ?`, u); err != nil {
		t.Fatal(err)
	}
	if got := activityFor(t, d, u); got.TotalSeconds < 3600 || got.Sessions != 1 {
		t.Fatalf("active activity = %+v", got)
	}
	if err := d.CheckpointVoiceActivity(); err != nil {
		t.Fatal(err)
	}
	if err := d.CheckpointVoiceActivity(); err != nil {
		t.Fatal(err)
	}
	if err := d.JoinVoiceChannel(u, b); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`UPDATE voice_activity_clock SET accounted_at = unixepoch() - 120 WHERE user_id = ?`, u); err != nil {
		t.Fatal(err)
	}
	if err := d.LeaveVoiceChannel(u); err != nil {
		t.Fatal(err)
	}
	if err := d.LeaveVoiceChannel(u); err != nil {
		t.Fatal(err)
	}
	got := activityFor(t, d, u)
	if got.TotalSeconds < 3720 || got.TotalSeconds > 3723 || got.Sessions != 2 {
		t.Fatalf("final activity = %+v", got)
	}
	channelTotals, err := d.GetVoiceChannelActivity()
	if err != nil {
		t.Fatal(err)
	}
	if len(channelTotals) != 2 || channelTotals[0].UserID != u || channelTotals[0].ChannelID != a || channelTotals[0].TotalSeconds < 3600 || channelTotals[1].ChannelID != b || channelTotals[1].TotalSeconds < 120 {
		t.Fatalf("per-channel activity = %+v", channelTotals)
	}
	// Deleting a channel does not erase the participant's lifetime total.
	if _, err := d.Exec(`DELETE FROM channels WHERE id = ?`, a); err != nil {
		t.Fatal(err)
	}
	if after := activityFor(t, d, u); after != got {
		t.Fatalf("channel deletion changed total: %+v", after)
	}
}

func TestActivityStartupDoesNotCountDowntimeOrPrivateCalls(t *testing.T) {
	d := newVoiceTestDB(t)
	u := seedVoiceUser(t, d, "restart_user")
	ch, err := d.CreateChannel("voice", "voice", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.JoinVoiceChannel(u, ch); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`UPDATE voice_activity_clock SET accounted_at = unixepoch() - 60`); err != nil {
		t.Fatal(err)
	}
	if err := d.CheckpointVoiceActivity(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`UPDATE voice_activity_clock SET accounted_at = unixepoch() - 86400`); err != nil {
		t.Fatal(err)
	}
	if err := d.ClearAllVoiceStates(); err != nil {
		t.Fatal(err)
	}
	got := activityFor(t, d, u)
	if got.TotalSeconds < 60 || got.TotalSeconds > 62 {
		t.Fatalf("downtime counted: %+v", got)
	}
	dm, err := d.CreateChannel("private", "dm", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.JoinVoiceChannel(u, dm); err != nil {
		t.Fatal(err)
	}
	if err := d.LeaveVoiceChannel(u); err != nil {
		t.Fatal(err)
	}
	if after := activityFor(t, d, u); after != got {
		t.Fatalf("private call changed stats: %+v", after)
	}
}
