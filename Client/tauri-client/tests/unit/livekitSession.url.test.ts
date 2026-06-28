// tests/unit/livekitSession.url.test.ts
import { describe, it, expect } from "vitest";
import { resolveLiveKitUrlWeb } from "../../src/lib/livekitSession";

describe("resolveLiveKitUrlWeb", () => {
  it("uses directUrl when provided", () => {
    expect(resolveLiveKitUrlWeb("chat.example", "/livekit", "wss://lk.example"))
      .toBe("wss://lk.example");
  });
  it("builds wss against server host for a proxy path", () => {
    expect(resolveLiveKitUrlWeb("chat.example", "/livekit"))
      .toBe("wss://chat.example/livekit");
  });
  it("passes through an absolute wss url", () => {
    expect(resolveLiveKitUrlWeb("chat.example", "wss://lk.example/rtc"))
      .toBe("wss://lk.example/rtc");
  });
});
