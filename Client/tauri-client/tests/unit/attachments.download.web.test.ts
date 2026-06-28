import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri-only plugins so the module loads in jsdom
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("@lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@lib/icons", () => ({ createIcon: () => document.createElement("span") }));
vi.mock("@lib/media-visibility", () => ({ observeMedia: vi.fn() }));
vi.mock("../../src/components/message-list/media", () => ({ openImageLightbox: vi.fn() }));
// Do NOT mock platform/index — isTauri() must return false (no __TAURI_INTERNALS__ in jsdom)

import { downloadFile } from "../../src/components/message-list/attachments";

describe("downloadFile (web path)", () => {
  beforeEach(() => {
    // jsdom's Response constructor with Blob body fails (no .stream()); use a plain
    // response-shaped object so res.ok and res.blob() both work.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: true, blob: () => Promise.resolve(new Blob(["data"])) } as unknown as Response,
    );
    // jsdom lacks createObjectURL
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  });

  it("creates an anchor and clicks it to download", async () => {
    const click = vi.fn();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag) as HTMLElement;
      if (tag === "a") (el as HTMLAnchorElement).click = click;
      return el;
    });
    await downloadFile("https://chat.example/files/a.png", "a.png");
    expect(click).toHaveBeenCalled();
  });
});
