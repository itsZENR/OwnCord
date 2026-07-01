import { describe, it, expect, beforeEach, vi } from "vitest";

const checkForUpdate = vi.fn();
const downloadAndInstallUpdate = vi.fn();
vi.mock("../../src/lib/updater", () => ({
  checkForUpdate: (...args: unknown[]) => checkForUpdate(...args),
  downloadAndInstallUpdate: (...args: unknown[]) => downloadAndInstallUpdate(...args),
}));

import { createUpdateNotifier } from "../../src/components/UpdateNotifier";

describe("UpdateNotifier.checkNow", () => {
  let root: HTMLElement;

  beforeEach(() => {
    checkForUpdate.mockReset();
    downloadAndInstallUpdate.mockReset();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("shows the update banner when an update is available", async () => {
    checkForUpdate.mockResolvedValue({ available: true, version: "1.2.3", body: "notes" });
    const n = createUpdateNotifier({ serverUrl: "https://x" });
    n.mount(root);
    n.checkNow();
    await vi.waitFor(() => {
      expect(root.querySelector(".update-banner")).not.toBeNull();
    });
    expect(root.textContent).toContain("1.2.3");
    expect(checkForUpdate).toHaveBeenCalledWith("https://x");
  });

  it("does nothing when no update is available", async () => {
    checkForUpdate.mockResolvedValue({ available: false, version: null, body: null });
    const n = createUpdateNotifier({ serverUrl: "https://x" });
    n.mount(root);
    n.checkNow();
    await new Promise((r) => setTimeout(r, 30));
    expect(root.querySelector(".update-banner")).toBeNull();
  });

  it("re-prompts after a prior banner was dismissed", async () => {
    checkForUpdate.mockResolvedValue({ available: true, version: "2.0.0", body: "" });
    const n = createUpdateNotifier({ serverUrl: "https://x" });
    n.mount(root);

    n.checkNow();
    await vi.waitFor(() => expect(root.querySelector(".update-banner")).not.toBeNull());

    // Dismiss via the "Later" button — sets the internal dismissed flag.
    (root.querySelector(".update-banner-later") as HTMLButtonElement).click();
    expect(root.querySelector(".update-banner")).toBeNull();

    // A freshly announced release must re-show even after a dismiss.
    n.checkNow();
    await vi.waitFor(() => expect(root.querySelector(".update-banner")).not.toBeNull());
  });
});
