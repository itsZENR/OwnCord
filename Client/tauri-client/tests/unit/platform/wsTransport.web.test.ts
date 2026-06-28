import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWebWsTransport } from "../../../src/lib/platform/wsTransport.web";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  _open() { this.readyState = 1; this.onopen?.(); }
  _msg(data: string) { this.onmessage?.({ data }); }
}

describe("web WS transport", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  it("opens a native WebSocket and reports open state", async () => {
    const t = createWebWsTransport();
    const states: boolean[] = [];
    t.onState((open) => states.push(open));
    await t.connect("wss://chat.example/api/v1/ws");
    const sock = FakeWebSocket.instances[0]!;
    expect(sock.url).toBe("wss://chat.example/api/v1/ws");
    sock._open();
    expect(states).toContain(true);
  });

  it("forwards incoming messages as raw strings", async () => {
    const t = createWebWsTransport();
    const got: string[] = [];
    t.onMessage((raw) => got.push(raw));
    await t.connect("wss://chat.example/api/v1/ws");
    FakeWebSocket.instances[0]!._msg('{"type":"ping"}');
    expect(got).toEqual(['{"type":"ping"}']);
  });

  it("send writes to the underlying socket", async () => {
    const t = createWebWsTransport();
    await t.connect("wss://chat.example/api/v1/ws");
    const sock = FakeWebSocket.instances[0]!;
    sock._open();
    t.send("hello");
    expect(sock.sent).toEqual(["hello"]);
  });
});
