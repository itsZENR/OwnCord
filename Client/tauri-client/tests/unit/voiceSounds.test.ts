import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { playVoiceJoinSound } from "../../src/lib/voiceSounds";

// Minimal Web Audio API mock that records what was scheduled.
class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  value = 0;
}
class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
}
class FakeOsc {
  type = "";
  frequency = new FakeParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeAudioContext {
  static oscillators: FakeOsc[] = [];
  static gains: FakeGain[] = [];
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn();
  createGain() { const g = new FakeGain(); FakeAudioContext.gains.push(g); return g; }
  createOscillator() { const o = new FakeOsc(); FakeAudioContext.oscillators.push(o); return o; }
}

describe("playVoiceJoinSound", () => {
  beforeEach(() => {
    FakeAudioContext.oscillators = [];
    FakeAudioContext.gains = [];
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("plays two ascending notes (D5 then A5)", () => {
    playVoiceJoinSound();
    const freqs = FakeAudioContext.oscillators.map((o) => o.frequency.value);
    expect(freqs).toEqual([587.33, 880]);
    expect(freqs[1]).toBeGreaterThan(freqs[0]!); // ascending
  });

  it("starts and stops every oscillator (no dangling nodes)", () => {
    playVoiceJoinSound();
    expect(FakeAudioContext.oscillators).toHaveLength(2);
    for (const o of FakeAudioContext.oscillators) {
      expect(o.start).toHaveBeenCalledOnce();
      expect(o.stop).toHaveBeenCalledOnce();
    }
  });

  it("does not throw when the Web Audio API is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => playVoiceJoinSound()).not.toThrow();
  });
});
