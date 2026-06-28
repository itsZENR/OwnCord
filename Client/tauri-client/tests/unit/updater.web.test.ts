import { describe, it, expect } from "vitest";
import { checkForUpdate } from "../../src/lib/updater";

describe("updater (web path)", () => {
  it("reports no update available on web", async () => {
    expect(await checkForUpdate("https://chat.example")).toEqual({
      available: false, version: null, body: null,
    });
  });
});
