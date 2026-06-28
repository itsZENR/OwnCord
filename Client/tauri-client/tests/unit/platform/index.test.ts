import { describe, it, expect, afterEach } from "vitest";
import { isTauri } from "../../../src/lib/platform";

describe("isTauri", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("returns false in a plain browser/jsdom environment", () => {
    expect(isTauri()).toBe(false);
  });

  it("returns true when the Tauri internals global is present", () => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });
});
