import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the Tauri event handlers the transport registers so we can drive them.
const handlers: Record<string, (e: { payload: unknown }) => void> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, h: (e: { payload: unknown }) => void) => {
    handlers[name] = h;
    return () => {};
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { createTauriWsTransport } from "../../../src/lib/platform/wsTransport.tauri";

describe("Tauri WS transport ws-state handling", () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it("maps only open/closed to onState and ignores the transitional 'connecting'", async () => {
    const t = createTauriWsTransport();
    const states: boolean[] = [];
    t.onState((open) => states.push(open));

    await t.connect("wss://example/api/v1/ws"); // triggers ensure() → registers listeners

    const wsState = handlers["ws-state"];
    if (wsState === undefined) throw new Error("ws-state listener was not registered");

    // The Rust proxy emits "connecting" before "open". It must NOT be treated
    // as a close (doing so fires a spurious reconnect → duplicate connection →
    // server-side single-session kick → endless reconnect loop).
    wsState({ payload: "connecting" });
    wsState({ payload: "open" });
    wsState({ payload: "connecting" });
    wsState({ payload: "closed" });

    expect(states).toEqual([true, false]);
  });
});
