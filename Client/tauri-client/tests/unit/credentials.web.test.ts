import { describe, it, expect, beforeEach } from "vitest";
import { saveCredential, loadCredential, deleteCredential } from "../../src/lib/credentials";

describe("credentials (web/localStorage path)", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

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

  it("uses the same credential for equivalent server addresses", async () => {
    await saveCredential("https://CHAT.example:8443/", "alice", "token");
    expect(await loadCredential("chat.example:8443")).toEqual({ username: "alice", token: "token" });
  });

  it("does not persist a browser login when remember me is disabled", async () => {
    await saveCredential("chat.example", "alice", "old-token");
    await saveCredential("chat.example", "alice", "new-token", "password", false);
    expect(localStorage.getItem("owncord:cred:chat.example")).toBeNull();
    expect(await loadCredential("chat.example")).toEqual({ username: "alice", token: "new-token" });
    expect(sessionStorage.getItem("owncord:cred:chat.example")).not.toContain("password");
    sessionStorage.clear();
    expect(await loadCredential("chat.example")).toBeNull();
  });
});
