// tests/unit/platform/kvStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getSettings, saveSettings } from "../../../src/lib/platform/kvStore";

describe("kvStore (web/localStorage path)", () => {
  beforeEach(() => localStorage.clear());

  it("returns an empty object when nothing stored", async () => {
    expect(await getSettings()).toEqual({});
  });

  it("round-trips a value under a key", async () => {
    await saveSettings("windowState", { x: 1, y: 2 });
    expect(await getSettings()).toEqual({ windowState: { x: 1, y: 2 } });
  });

  it("merges multiple keys", async () => {
    await saveSettings("a", 1);
    await saveSettings("b", 2);
    expect(await getSettings()).toEqual({ a: 1, b: 2 });
  });
});
