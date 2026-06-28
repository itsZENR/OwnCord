// tests/unit/livekitSession.url.test.ts
import { describe, it, expect } from "vitest";
import { resolveLiveKitUrlWeb } from "../../src/lib/livekitSession";

describe("resolveLiveKitUrlWeb", () => {
  it("uses directUrl only when it is a secure wss URL", () => {
    expect(resolveLiveKitUrlWeb("chat.example", "/livekit", "wss://lk.example"))
      .toBe("wss://lk.example");
  });
  it("ignores an insecure ws://localhost directUrl and routes through the proxy", () => {
    // The server always sends direct_url=ws://localhost:7880 (its co-located
    // LiveKit); a browser cannot use it, so it must fall back to the proxy.
    expect(resolveLiveKitUrlWeb("chat.example", "/livekit", "ws://localhost:7880"))
      .toBe("wss://chat.example/livekit");
  });
  it("builds wss against server host for a proxy path", () => {
    expect(resolveLiveKitUrlWeb("chat.example", "/livekit"))
      .toBe("wss://chat.example/livekit");
  });
  it("preserves a non-default port in the server host", () => {
    expect(resolveLiveKitUrlWeb("localhost:9443", "/livekit", "ws://localhost:7880"))
      .toBe("wss://localhost:9443/livekit");
  });
  it("passes through an absolute wss url", () => {
    expect(resolveLiveKitUrlWeb("chat.example", "wss://lk.example/rtc"))
      .toBe("wss://lk.example/rtc");
  });
});
