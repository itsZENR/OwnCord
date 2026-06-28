import { describe, it, expect } from "vitest";
import { initLogPersistence, getLogDir } from "../../src/lib/logPersistence";

describe("logPersistence (web path)", () => {
  it("init is a safe no-op returning a cleanup fn and no log dir", async () => {
    const cleanup = await initLogPersistence();
    expect(typeof cleanup).toBe("function");
    expect(getLogDir()).toBeNull();
    cleanup();
  });
});
