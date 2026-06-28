import { describe, it, expect, beforeEach } from "vitest";
import { saveCredential, loadCredential, deleteCredential } from "../../src/lib/credentials";

describe("credentials (web/localStorage path)", () => {
  beforeEach(() => localStorage.clear());

  it("saves and loads username + token, omitting password", async () => {
    await saveCredential("chat.example", "alice", "tok123", "secret");
    const cred = await loadCredential("chat.example");
    expect(cred).toEqual({ username: "alice", token: "tok123" });
  });

  it("returns null for unknown host", async () => {
    expect(await loadCredential("nope.example")).toBeNull();
  });

  it("deletes a stored credential", async () => {
    await saveCredential("chat.example", "alice", "tok123");
    await deleteCredential("chat.example");
    expect(await loadCredential("chat.example")).toBeNull();
  });
});
