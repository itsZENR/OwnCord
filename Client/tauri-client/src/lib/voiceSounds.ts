// Synthesized voice-channel UI sounds. No audio assets are bundled — the tones
// are generated with the Web Audio API, which works identically in the browser
// and the Tauri webview. Joining voice is always user-initiated (a click), so
// browser autoplay policies do not block playback.
import { createLogger } from "./logger";

const log = createLogger("voiceSounds");

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

/** Lazily create (and resume) a shared AudioContext. Returns null if the Web
 * Audio API is unavailable. */
function getCtx(): AudioContext | null {
  try {
    if (ctx === null) {
      const Ctor: AudioCtor | undefined =
        typeof window !== "undefined"
          ? (window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)
          : undefined;
      if (Ctor === undefined) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Master volume for UI sounds (kept low so the blip is a cue, not a jolt). */
const MASTER_GAIN = 0.18;
const NOTE_DURATION_S = 0.12;
const NOTE_GAP_S = 0.085;

/** Play a sequence of short sine-tone notes through the shared context. */
function playBlip(freqs: readonly number[]): void {
  const audio = getCtx();
  if (audio === null) return;
  try {
    const now = audio.currentTime;
    const master = audio.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(audio.destination);

    freqs.forEach((freq, i) => {
      const start = now + i * NOTE_GAP_S;
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Quick attack, exponential decay — avoids clicks at note edges.
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(1, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_DURATION_S);
      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + NOTE_DURATION_S + 0.02);
    });
  } catch (err) {
    log.debug("Failed to play voice sound", err);
  }
}

/** Ascending two-note cue played when the local user connects to a voice
 * channel (Discord-style join blip). */
export function playVoiceJoinSound(): void {
  playBlip([587.33, 880]); // D5 → A5
}
