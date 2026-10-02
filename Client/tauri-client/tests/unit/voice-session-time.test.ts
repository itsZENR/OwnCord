import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionDuration, getChannelSessionStart, sessionDuration } from "../../src/lib/voiceSessionTime";
import { removeVoiceUser, resetVoiceStore, setSpeakers, setVoiceStates, updateVoiceState, voiceStore } from "../../src/stores/voice.store";

describe("server voice session clocks", () => {
  beforeEach(() => { resetVoiceStore(); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
  afterEach(() => { vi.useRealTimers(); resetVoiceStore(); });

  it("restores each participant's duration and the shared session despite device clock skew", () => {
    const serverTime = 1_700_000_000;
    setVoiceStates([
      { user_id: 1, channel_id: 10, muted: false, deafened: false, joined_at: serverTime - 7200, channel_started_at: serverTime - 7200, server_time: serverTime },
      { user_id: 2, channel_id: 10, muted: false, deafened: false, joined_at: serverTime - 60, channel_started_at: serverTime - 7200, server_time: serverTime },
    ]);
    expect(sessionDuration(voiceStore.getState().voiceUsers.get(10)!.get(2)!.joinedAt)).toBe("00:01:00");
    removeVoiceUser({ user_id: 1, channel_id: 10 });
    vi.advanceTimersByTime(5000);
    setSpeakers({ channel_id: 10, speakers: [2] });
    updateVoiceState({ user_id: 2, channel_id: 10, username: "second", muted: true, deafened: false, speaking: false, camera: false, screenshare: false });
    const users = voiceStore.getState().voiceUsers.get(10)!;
    expect(sessionDuration(users.get(2)!.joinedAt)).toBe("00:01:05");
    expect(sessionDuration(getChannelSessionStart(users.values()))).toBe("02:00:05");
  });

  it("uses new connection timestamps and never substitutes lifetime hours or another member's join", () => {
    updateVoiceState({ user_id: 1, channel_id: 10, username: "first", muted: false, deafened: false, speaking: false, camera: false, screenshare: false, joined_at: 1_800_000_000 });
    expect(sessionDuration(getChannelSessionStart(voiceStore.getState().voiceUsers.get(10)!.values()))).toBe("—");
    expect(sessionDuration(undefined)).toBe("—");
    expect(sessionDuration(1_800_000_005)).toBe("00:00:00");
    expect(formatSessionDuration(25 * 3600 + 61)).toBe("25:01:01");
  });
});
