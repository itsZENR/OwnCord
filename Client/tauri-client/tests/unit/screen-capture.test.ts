import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createLocalScreenTracks, type LocalTrack } from "livekit-client";
import { captureScreen } from "../../src/lib/screenCapture";

vi.mock("livekit-client", () => ({
  createLocalScreenTracks: vi.fn(),
  Track: { Kind: { Video: "video", Audio: "audio" } },
}));

function track(kind: string, settings: MediaTrackSettings & { restrictOwnAudio?: boolean }) {
  return { kind, stop: vi.fn(), mediaStreamTrack: { getSettings: () => settings, contentHint: "" } };
}

describe("screen capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { mediaDevices: {
      getSupportedConstraints: () => ({ restrictOwnAudio: true }),
    } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("requests uncropped video and excludes the call's audio and tab", async () => {
    const video = track("video", { displaySurface: "monitor" });
    const audio = track("audio", { restrictOwnAudio: true });
    vi.mocked(createLocalScreenTracks).mockResolvedValue([video, audio] as unknown as LocalTrack[]);
    const result = await captureScreen({ resolution: { width: 0, height: 0 } });
    expect(createLocalScreenTracks).toHaveBeenCalledWith(expect.objectContaining({
      video: { displaySurface: "window", resizeMode: "none" },
      audio: { echoCancellation: true, restrictOwnAudio: true },
      systemAudio: "include", selfBrowserSurface: "exclude",
      resolution: { width: 0, height: 0 },
    }));
    expect(result.tracks).toEqual([video, audio]);
    expect(result.audioUnavailable).toBe(false);
    expect(video.mediaStreamTrack.contentHint).toBe("detail");
  });

  it.each(["monitor", "window", undefined])("drops unfiltered audio for %s sources", async (displaySurface) => {
    const video = track("video", { displaySurface });
    const audio = track("audio", {});
    vi.mocked(createLocalScreenTracks).mockResolvedValue([video, audio] as unknown as LocalTrack[]);
    const result = await captureScreen({});
    expect(result.tracks).toEqual([video]);
    expect(result.audioUnavailable).toBe(true);
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(video.stop).not.toHaveBeenCalled();
  });

  it("preserves selected-tab audio on browsers without own-audio filtering", async () => {
    vi.spyOn(navigator.mediaDevices, "getSupportedConstraints").mockReturnValue({});
    const video = track("video", { displaySurface: "browser" });
    const audio = track("audio", {});
    vi.mocked(createLocalScreenTracks).mockResolvedValue([video, audio] as unknown as LocalTrack[]);
    const result = await captureScreen({});
    expect(createLocalScreenTracks).toHaveBeenCalledWith(expect.objectContaining({ systemAudio: "exclude" }));
    expect(result.tracks).toEqual([video, audio]);
    expect(result.audioUnavailable).toBe(false);
  });
});
