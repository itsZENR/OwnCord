// tests/unit/platform/http.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { platformFetch } from "../../../src/lib/platform/http";

describe("platformFetch (web path)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls native fetch with the given url and init in a browser env", async () => {
    const fake = new Response("ok", { status: 200 });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fake);
    const res = await platformFetch("https://example.test/api", { method: "GET" });
    expect(spy).toHaveBeenCalledWith("https://example.test/api", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("tolerates a Tauri-style danger field by passing it through to native fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const init = { method: "POST", danger: { acceptInvalidCerts: true } } as RequestInit;
    await platformFetch("https://example.test/x", init);
    expect(spy).toHaveBeenCalledOnce();
  });
});
