package db

import "fmt"

type VoiceActivity struct {
	UserID       int64 `json:"user_id"`
	TotalSeconds int64 `json:"total_seconds"`
	Sessions     int64 `json:"sessions"`
}

// VoiceChannelActivity is the lifetime voice time for one user in one
// persistent voice channel. Active sessions include their uncheckpointed
// portion, just like GetVoiceActivity.
type VoiceChannelActivity struct {
	UserID       int64
	ChannelID    int64
	TotalSeconds int64
}

// GetVoiceActivity includes the uncheckpointed portion of active sessions.
// Clock time is authoritative on the server, never supplied by clients.
func (d *DB) GetVoiceActivity() ([]VoiceActivity, error) {
	rows, err := d.sqlDB.Query(`SELECT a.user_id,
	 a.total_seconds + COALESCE(max(0, unixepoch() - c.accounted_at), 0), a.sessions
	 FROM voice_activity a LEFT JOIN voice_activity_clock c ON c.user_id = a.user_id
	 ORDER BY a.user_id`)
	if err != nil {
		return nil, fmt.Errorf("GetVoiceActivity: %w", err)
	}
	defer rows.Close()
	result := []VoiceActivity{}
	for rows.Next() {
		var item VoiceActivity
		if err := rows.Scan(&item.UserID, &item.TotalSeconds, &item.Sessions); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// GetVoiceChannelActivity returns per-channel totals used by the member list.
func (d *DB) GetVoiceChannelActivity() ([]VoiceChannelActivity, error) {
	rows, err := d.sqlDB.Query(`SELECT a.user_id, a.channel_id,
	 a.total_seconds + COALESCE(max(0, unixepoch() - c.accounted_at), 0)
	 FROM voice_channel_activity a
	 LEFT JOIN voice_activity_clock c
	   ON c.user_id = a.user_id AND c.channel_id = a.channel_id
	 ORDER BY a.channel_id, a.user_id`)
	if err != nil {
		return nil, fmt.Errorf("GetVoiceChannelActivity: %w", err)
	}
	defer rows.Close()
	result := []VoiceChannelActivity{}
	for rows.Next() {
		var item VoiceChannelActivity
		if err := rows.Scan(&item.UserID, &item.ChannelID, &item.TotalSeconds); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// CheckpointVoiceActivity bounds time lost on a process crash to the checkpoint
// interval. Resetting stale clocks at startup never awards server downtime.
func (d *DB) CheckpointVoiceActivity() error {
	tx, err := d.sqlDB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var now int64
	if err = tx.QueryRow(`SELECT unixepoch()`).Scan(&now); err != nil {
		return err
	}
	for _, query := range []string{
		`UPDATE voice_activity SET total_seconds = total_seconds + COALESCE(
		 (SELECT max(0, ? - accounted_at) FROM voice_activity_clock c WHERE c.user_id = voice_activity.user_id), 0)`,
		`UPDATE voice_channel_activity SET total_seconds = total_seconds + COALESCE(
		 (SELECT max(0, ? - accounted_at) FROM voice_activity_clock c WHERE c.user_id = voice_channel_activity.user_id AND c.channel_id = voice_channel_activity.channel_id), 0)`,
		`UPDATE voice_activity_clock SET accounted_at = ?`,
	} {
		if _, err = tx.Exec(query, now); err != nil {
			return fmt.Errorf("CheckpointVoiceActivity: %w", err)
		}
	}
	return tx.Commit()
}
