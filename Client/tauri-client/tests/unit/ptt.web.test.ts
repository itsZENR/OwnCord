import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/livekitSession", () => ({ setMuted: vi.fn() }));
vi.mock("../../src/stores/voice.store", () => ({
  voiceStore: { getState: () => ({ currentChannelId: channelId }) },
}));
vi.mock("../../src/lib/platform/index", () => ({ isTauri: () => false }));

import { setMuted } from "../../src/lib/livekitSession";
import { initPtt, updatePttKey, stopPtt, captureKeyPress } from "../../src/lib/ptt";
import { loadPref, savePref } from "../../src/components/settings/helpers";

let channelId: number | null = 1;
const key = (type: string, options: KeyboardEventInit = {}, target: EventTarget = window) => {
  target.dispatchEvent(new KeyboardEvent(type, { code: "KeyV", bubbles: true, ...options }));
};

describe("ptt (web path)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    channelId = 1;
  });
  afterEach(async () => {
    await stopPtt();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("leaves the microphone alone by default, including Ctrl+V", async () => {
    await initPtt();
    key("keydown");
    key("keyup");
    key("keydown", { ctrlKey: true });
    key("keyup", { ctrlKey: true });
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("restores the saved binding and only handles one press/release", async () => {
    savePref("pttVk", 0x56);
    await initPtt();
    await initPtt();
    key("keydown");
    key("keydown", { repeat: true });
    key("keyup");
    key("keyup");
    expect(vi.mocked(setMuted).mock.calls).toEqual([[false], [true]]);
  });

  it.each(["ctrlKey", "metaKey", "altKey", "shiftKey"])("ignores %s+V even when V is bound", async (modifier) => {
    await updatePttKey(0x56);
    key("keydown", { [modifier]: true });
    key("keyup", { code: "ControlLeft" });
    key("keydown", { repeat: true });
    key("keyup");
    expect(setMuted).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "div"])("ignores typing and pasting into %s", async (tag) => {
    await updatePttKey(0x56);
    const field = document.createElement(tag);
    if (tag === "div") field.setAttribute("contenteditable", "true");
    document.body.append(field);
    key("keydown", {}, field);
    key("keyup", {}, field);
    key("keydown", { ctrlKey: true }, field);
    key("keyup", {}, field);
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("persists a changed binding and fully disables a cleared binding", async () => {
    await updatePttKey(0x52);
    expect(loadPref("pttVk", 0)).toBe(0x52);
    key("keydown");
    key("keyup");
    expect(setMuted).not.toHaveBeenCalled();
    key("keydown", { code: "KeyR" });
    key("keyup", { code: "KeyR" });
    expect(vi.mocked(setMuted).mock.calls).toEqual([[false], [true]]);
    await updatePttKey(0);
    expect(loadPref("pttVk", -1)).toBe(0);
    vi.clearAllMocks();
    await initPtt();
    key("keydown", { code: "KeyR" });
    key("keyup", { code: "KeyR" });
    key("keydown");
    key("keyup");
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("releases an active press on blur but ignores a later keyup", async () => {
    await updatePttKey(0x56);
    key("keydown");
    window.dispatchEvent(new Event("blur"));
    key("keyup");
    expect(vi.mocked(setMuted).mock.calls).toEqual([[false], [true]]);
  });

  it("does not mute a different channel on release", async () => {
    await updatePttKey(0x56);
    key("keydown");
    channelId = 2;
    key("keyup");
    expect(vi.mocked(setMuted).mock.calls).toEqual([[false]]);
  });

  it("ignores a press outside a voice channel", async () => {
    await updatePttKey(0x56);
    channelId = null;
    key("keydown");
    channelId = 1;
    key("keyup");
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("does not substitute V for an unsupported key", async () => {
    const capture = captureKeyPress();
    key("keydown", { code: "Unidentified" });
    expect(await capture).toBe(0);
    await updatePttKey(0xFF);
    key("keydown");
    key("keyup");
    expect(setMuted).not.toHaveBeenCalled();
  });

  it("times out key capture", async () => {
    vi.useFakeTimers();
    const capture = captureKeyPress();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await capture).toBe(0);
  });
});
