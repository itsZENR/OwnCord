// Synthesized voice-channel UI sounds. No audio assets are bundled — the tones
// are generated with the Web Audio API, which works identically in the browser
// and the Tauri webview. Every cue is triggered by a user action or a live
// voice connection, so browser autoplay policies do not block playback.
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
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Warm up the audio context from a user gesture (e.g. clicking a voice channel)
 * so it is already "running" by the time an async event (join, etc.) plays a
 * cue. Autoplay policies keep a context created off-gesture "suspended", and a
 * cue scheduled while suspended is silent — hence sounds not always playing.
 */
export function primeVoiceAudio(): void {
  const audio = getCtx();
  if (audio !== null && audio.state === "suspended") {
    audio.resume().catch(() => { /* best-effort */ });
  }
}

interface BlipOptions {
  /** Master volume for the cue (0–1). Self cues are louder than "others" cues. */
  readonly gain?: number;
  /** Per-note duration in seconds. */
  readonly noteDuration?: number;
  /** Gap between note onsets in seconds. */
  readonly gap?: number;
}

const DEFAULT_GAIN = 0.18;
const DEFAULT_NOTE_DURATION = 0.12;
const DEFAULT_GAP = 0.085;

/** Play a sequence of short sine-tone notes through the shared context. */
function playBlip(freqs: readonly number[], opts: BlipOptions = {}): void {
  const audio = getCtx();
  if (audio === null) return;
  const masterGain = opts.gain ?? DEFAULT_GAIN;
  const noteDur = opts.noteDuration ?? DEFAULT_NOTE_DURATION;
  const gap = opts.gap ?? DEFAULT_GAP;

  const schedule = (): void => {
    try {
      const now = audio.currentTime;
      const master = audio.createGain();
      master.gain.value = masterGain;
      master.connect(audio.destination);

      freqs.forEach((freq, i) => {
        const start = now + i * gap;
        const osc = audio.createOscillator();
        const env = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        // Quick attack, exponential decay — avoids clicks at note edges.
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(1, start + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, start + noteDur);
        osc.connect(env);
        env.connect(master);
        osc.start(start);
        osc.stop(start + noteDur + 0.02);
      });
    } catch (err) {
      log.debug("Failed to play voice sound", err);
    }
  };

  // A cue scheduled while the context is suspended is silent. Resume first and
  // schedule the notes only once the context is actually running, so the notes
  // are never scheduled in the past.
  if (audio.state === "suspended") {
    log.debug("voice sound: context suspended, resuming before play");
    audio.resume().then(schedule).catch((err) => log.debug("voice sound: resume failed", err));
  } else {
    schedule();
  }
}

// Note frequencies (Hz).
const D5 = 587.33;
const A5 = 880;
const A4 = 440;
const E5 = 659.25;
const C5 = 523.25;
const G5 = 783.99;
const C6 = 1046.5;
const D4 = 293.66;

// --- Self cues (louder) ---

/** Ascending two-note cue when the local user connects to a voice channel. */
export function playVoiceJoinSound(): void {
  playBlip([D5, A5]);
}

/** Descending two-note cue when the local user leaves a voice channel. */
export function playVoiceLeaveSound(): void {
  playBlip([A5, D5]);
}

/** Short low note when the local user mutes their mic. */
export function playMuteSound(): void {
  playBlip([A4], { noteDuration: 0.1 });
}

/** Short higher note when the local user unmutes their mic. */
export function playUnmuteSound(): void {
  playBlip([E5], { noteDuration: 0.1 });
}

/** Descending pair when the local user deafens. */
export function playDeafenSound(): void {
  playBlip([D5, A4]);
}

/** Ascending pair when the local user undeafens. */
export function playUndeafenSound(): void {
  playBlip([A4, D5]);
}

/** Quick rising triple when the voice connection is recovered. */
export function playReconnectSound(): void {
  playBlip([C5, E5, G5], { gap: 0.07, noteDuration: 0.1 });
}

/** Low descending cue when the voice connection is unexpectedly lost. */
export function playDisconnectSound(): void {
  playBlip([A4, D4], { noteDuration: 0.16, gap: 0.11 });
}

/** Rising pair when the local user turns their camera on. */
export function playCameraOnSound(): void {
  playBlip([E5, A5], { noteDuration: 0.1 });
}

/** Falling pair when the local user turns their camera off. */
export function playCameraOffSound(): void {
  playBlip([A5, E5], { noteDuration: 0.1 });
}

/** Rising triple when the local user starts sharing their screen. */
export function playScreenshareOnSound(): void {
  playBlip([C5, G5, C6], { gap: 0.07, noteDuration: 0.1 });
}

/** Falling triple when the local user stops sharing their screen. */
export function playScreenshareOffSound(): void {
  playBlip([C6, G5, C5], { gap: 0.07, noteDuration: 0.1 });
}

// --- Others cues (quieter, higher, lighter) ---

const OTHERS_GAIN = 0.1;
const OTHERS_NOTE = 0.08;

/** Light rising blip when another user joins the local user's voice channel. */
export function playUserJoinedSound(): void {
  if (othersSuppressed) return;
  playBlip([G5, C6], { gain: OTHERS_GAIN, noteDuration: OTHERS_NOTE, gap: 0.06 });
}

/** Light falling blip when another user leaves the local user's voice channel. */
export function playUserLeftSound(): void {
  if (othersSuppressed) return;
  playBlip([C6, G5], { gain: OTHERS_GAIN, noteDuration: OTHERS_NOTE, gap: 0.06 });
}

// The server replays every existing participant's voice_state to a joiner. To
// avoid a burst of "user joined" cues on channel entry, suppress the others
// cues for a short window right after the local user joins.
let othersSuppressed = false;
let othersSuppressTimer: ReturnType<typeof setTimeout> | null = null;

/** Suppress "user joined/left" cues briefly (call when the local user joins a
 * voice channel, so the initial participant sync stays silent). */
export function suppressOthersCuesBriefly(): void {
  othersSuppressed = true;
  if (othersSuppressTimer !== null) clearTimeout(othersSuppressTimer);
  othersSuppressTimer = setTimeout(() => { othersSuppressed = false; othersSuppressTimer = null; }, 1500);
}
