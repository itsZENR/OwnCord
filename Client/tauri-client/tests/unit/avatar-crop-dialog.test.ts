import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseAvatarCrop } from "@components/settings/AvatarCropDialog";
import { avatarSourceRect } from "@lib/avatarUpload";

describe("avatar crop", () => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 600, height: 300, close: vi.fn() })));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:avatar-preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    document.querySelector("[data-testid='avatar-crop-dialog']")?.remove();
  });

  it("shows the circular frame and saves a dragged, zoomed crop", async () => {
    const file = new File(["image"], "avatar.png", { type: "image/png" });
    const pending = chooseAvatarCrop(file, new AbortController().signal);
    await vi.waitFor(() => expect(document.querySelector("[data-testid='avatar-crop-dialog']")).not.toBeNull());
    const viewport = document.querySelector("[data-testid='avatar-crop-viewport']") as HTMLElement;
    expect(viewport.querySelector(".avatar-crop-guide")).not.toBeNull();
    Object.defineProperty(viewport, "setPointerCapture", { value: vi.fn() });
    const zoom = document.querySelector("[data-testid='avatar-crop-zoom']") as HTMLInputElement;
    zoom.value = "2";
    zoom.dispatchEvent(new Event("input"));
    viewport.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 140, clientY: 140 }));
    viewport.dispatchEvent(new MouseEvent("pointermove", { clientX: 70, clientY: 140 }));
    (document.querySelector("[data-testid='avatar-crop-save']") as HTMLButtonElement).click();
    const crop = await pending;
    expect(crop?.zoom).toBe(2);
    expect(crop?.centerX).toBeGreaterThan(0.5);
    expect(crop?.centerY).toBe(0.5);
    expect(avatarSourceRect(600, 300, crop!).x).toBeGreaterThan(225);
    expect(document.querySelector("[data-testid='avatar-crop-dialog']")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-preview");
  });

  it("cancels without producing an upload", async () => {
    const pending = chooseAvatarCrop(new File(["image"], "avatar.png", { type: "image/png" }), new AbortController().signal);
    await vi.waitFor(() => expect(document.querySelector("[data-testid='avatar-crop-cancel']")).not.toBeNull());
    (document.querySelector("[data-testid='avatar-crop-cancel']") as HTMLButtonElement).click();
    expect(await pending).toBeNull();
  });

  it("keeps the selected square within the source image", () => {
    expect(avatarSourceRect(400, 200, { centerX: 0.95, centerY: 0, zoom: 2 })).toEqual({ x: 300, y: 0, side: 100 });
  });
});
