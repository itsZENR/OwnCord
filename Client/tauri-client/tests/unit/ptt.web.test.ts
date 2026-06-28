// tests/unit/ptt.web.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/livekitSession", () => ({ setMuted: vi.fn() }));
vi.mock("../../src/stores/voice.store", () => ({
  voiceStore: { getState: () => ({ currentChannelId: 1 }) },
}));

import { setMuted } from "../../src/lib/livekitSession";
import { initPtt, updatePttKey, stopPtt } from "../../src/lib/ptt";

describe("ptt (web path)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unmutes on keydown and mutes on keyup of the configured key", async () => {
    await updatePttKey(0x41); // 'A'
    await initPtt();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(setMuted).toHaveBeenLastCalledWith(false);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    expect(setMuted).toHaveBeenLastCalledWith(true);
    await stopPtt();
  });
});
