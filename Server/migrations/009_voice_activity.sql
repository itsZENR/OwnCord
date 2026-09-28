-- Server-owned cumulative time. Private calls do not contribute to channel hours.
CREATE TABLE IF NOT EXISTS voice_activity (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS voice_channel_activity (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel_id)
);
CREATE TABLE IF NOT EXISTS voice_activity_clock (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    accounted_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS voice_activity_join AFTER INSERT ON voice_states
WHEN (SELECT type FROM channels WHERE id = NEW.channel_id) = 'voice'
BEGIN
    INSERT INTO voice_activity(user_id, sessions) VALUES(NEW.user_id, 1)
      ON CONFLICT(user_id) DO UPDATE SET sessions = sessions + 1;
    INSERT OR IGNORE INTO voice_channel_activity(user_id, channel_id) VALUES(NEW.user_id, NEW.channel_id);
    INSERT OR REPLACE INTO voice_activity_clock(user_id, channel_id, accounted_at)
      VALUES(NEW.user_id, NEW.channel_id, unixepoch());
END;

CREATE TRIGGER IF NOT EXISTS voice_activity_leave BEFORE DELETE ON voice_states
BEGIN
    UPDATE voice_activity SET total_seconds = total_seconds + COALESCE(
      (SELECT max(0, unixepoch() - accounted_at) FROM voice_activity_clock WHERE user_id = OLD.user_id), 0)
      WHERE user_id = OLD.user_id;
    UPDATE voice_channel_activity SET total_seconds = total_seconds + COALESCE(
      (SELECT max(0, unixepoch() - accounted_at) FROM voice_activity_clock WHERE user_id = OLD.user_id), 0)
      WHERE user_id = OLD.user_id AND channel_id = OLD.channel_id;
    DELETE FROM voice_activity_clock WHERE user_id = OLD.user_id;
END;
