-- One continuous session per occupied channel. It outlives the first member
-- and ends only when the channel becomes empty.
CREATE TABLE IF NOT EXISTS voice_channel_sessions (
    channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO voice_channel_sessions(channel_id, started_at)
SELECT channel_id, COALESCE(MIN(unixepoch(joined_at)), unixepoch())
FROM voice_states GROUP BY channel_id;

CREATE TRIGGER IF NOT EXISTS voice_session_join AFTER INSERT ON voice_states
BEGIN
    INSERT OR IGNORE INTO voice_channel_sessions(channel_id, started_at)
    VALUES(NEW.channel_id, COALESCE(unixepoch(NEW.joined_at), unixepoch()));
END;

CREATE TRIGGER IF NOT EXISTS voice_session_leave AFTER DELETE ON voice_states
WHEN NOT EXISTS (SELECT 1 FROM voice_states WHERE channel_id = OLD.channel_id)
BEGIN
    DELETE FROM voice_channel_sessions WHERE channel_id = OLD.channel_id;
END;
