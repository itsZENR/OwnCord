import { createLocalScreenTracks, Track, type LocalTrack, type ScreenShareCaptureOptions } from "livekit-client";

type OwnAudioSettings = MediaTrackSettings & { restrictOwnAudio?: boolean };
type OwnAudioSupport = MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean };

/** Capture only the selected source; never feed this call's audio back to peers. */
export async function captureScreen(options: ScreenShareCaptureOptions): Promise<{
  tracks: LocalTrack[];
  audioUnavailable: boolean;
}> {
  const canExcludeOwnAudio = (navigator.mediaDevices?.getSupportedConstraints?.() as OwnAudioSupport | undefined)
    ?.restrictOwnAudio === true;
  const audio = { echoCancellation: true, restrictOwnAudio: true };
  const video = { displaySurface: "window" as const, resizeMode: "none" };
  const tracks = await createLocalScreenTracks({
    ...options,
    video,
    audio,
    selfBrowserSurface: "exclude",
    // Without own-audio exclusion, full-system capture loops the call back.
    // Tab audio remains available even when system audio is excluded.
    systemAudio: canExcludeOwnAudio ? "include" : "exclude",
  });
  try {
    const videoTrack = tracks.find((track) => track.kind === Track.Kind.Video)?.mediaStreamTrack;
    const surface = videoTrack?.getSettings().displaySurface;
    if (videoTrack) videoTrack.contentHint = options.contentHint ?? "detail";
    const safeTracks: LocalTrack[] = [];
    let audioUnavailable = !canExcludeOwnAudio && surface !== "browser";
    for (const track of tracks) {
      if (track.kind === Track.Kind.Audio && surface !== "browser") {
        // Verify the browser applied the constraint. Unknown options can be
        // silently ignored by older WebView2/browser versions.
        const settings = track.mediaStreamTrack.getSettings() as OwnAudioSettings;
        if (settings.restrictOwnAudio !== true) {
          track.stop();
          audioUnavailable = true;
          continue;
        }
      }
      safeTracks.push(track);
    }
    return { tracks: safeTracks, audioUnavailable };
  } catch (error) {
    for (const track of tracks) track.stop();
    throw error;
  }
}
