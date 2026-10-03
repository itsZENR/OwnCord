import { appendChildren, createElement, setText } from "@lib/dom";
import { t } from "@lib/i18n";
import { validateAvatarFile } from "@lib/avatarUpload";
import type { AvatarCrop } from "@lib/avatarUpload";

const PREVIEW_SIZE = 280;

/** Let the user see the circular crop before uploading any image. */
export async function chooseAvatarCrop(file: File, ownerSignal: AbortSignal): Promise<AvatarCrop | null> {
  validateAvatarFile(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t("This image could not be opened.", "Не удалось открыть это изображение."));
  }
  const imageWidth = bitmap.width;
  const imageHeight = bitmap.height;
  bitmap.close();
  if (ownerSignal.aborted) return null;

  const imageUrl = URL.createObjectURL(file);
  return new Promise<AvatarCrop | null>((resolve) => {
    const listeners = new AbortController();
    const previousFocus = document.activeElement;
    const overlay = createElement("div", { class: "avatar-crop-overlay", "data-testid": "avatar-crop-dialog" });
    const dialog = createElement("div", {
      class: "avatar-crop-dialog", role: "dialog", "aria-modal": "true", "aria-label": t("Crop avatar", "Обрезка аватара"),
    });
    const title = createElement("h2", {}, t("Crop avatar", "Обрезка аватара"));
    const instructions = createElement("p", {}, t(
      "Drag the photo to choose its center. Use the mouse wheel to zoom. The circle shows what others will see.",
      "Перетащите фото, чтобы выбрать центр. Колёсико мыши меняет масштаб. В круге показано, что увидят другие.",
    ));
    const viewport = createElement("div", { class: "avatar-crop-viewport", "data-testid": "avatar-crop-viewport" });
    const image = createElement("img", { class: "avatar-crop-image", alt: "", src: imageUrl, draggable: "false" });
    const guide = createElement("div", { class: "avatar-crop-guide", "aria-hidden": "true" });
    appendChildren(viewport, image, guide);
    const zoomRow = createElement("label", { class: "avatar-crop-zoom-row" });
    const zoomLabel = createElement("span", {}, t("Zoom", "Масштаб"));
    const zoomSlider = createElement("input", {
      type: "range", min: "1", max: "3", step: "0.01", value: "1",
      "aria-label": t("Avatar zoom", "Масштаб аватара"), "data-testid": "avatar-crop-zoom",
    });
    const zoomValue = createElement("span", { class: "avatar-crop-zoom-value" }, "100%");
    appendChildren(zoomRow, zoomLabel, zoomSlider, zoomValue);
    const actions = createElement("div", { class: "avatar-crop-actions" });
    const cancel = createElement("button", { class: "ac-btn", type: "button", "data-testid": "avatar-crop-cancel" }, t("Cancel", "Отмена"));
    const save = createElement("button", { class: "ac-btn", type: "button", "data-testid": "avatar-crop-save" }, t("Save avatar", "Сохранить аватар"));
    appendChildren(actions, cancel, save);
    appendChildren(dialog, title, instructions, viewport, zoomRow, actions);
    overlay.appendChild(dialog);

    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let drag: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;
    const render = (): void => {
      const baseScale = PREVIEW_SIZE / Math.min(imageWidth, imageHeight);
      const displayWidth = imageWidth * baseScale * zoom;
      const displayHeight = imageHeight * baseScale * zoom;
      const maxX = (displayWidth - PREVIEW_SIZE) / 2;
      const maxY = (displayHeight - PREVIEW_SIZE) / 2;
      offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
      offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
      image.style.width = `${displayWidth}px`;
      image.style.height = `${displayHeight}px`;
      image.style.left = `${(PREVIEW_SIZE - displayWidth) / 2 + offsetX}px`;
      image.style.top = `${(PREVIEW_SIZE - displayHeight) / 2 + offsetY}px`;
      setText(zoomValue, `${Math.round(zoom * 100)}%`);
    };
    const finish = (result: AvatarCrop | null): void => {
      listeners.abort();
      ownerSignal.removeEventListener("abort", onOwnerAbort);
      overlay.remove();
      URL.revokeObjectURL(imageUrl);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(result);
    };
    const onOwnerAbort = (): void => finish(null);
    ownerSignal.addEventListener("abort", onOwnerAbort, { once: true });
    cancel.addEventListener("click", () => finish(null), { signal: listeners.signal });
    save.addEventListener("click", () => {
      const baseScale = PREVIEW_SIZE / Math.min(imageWidth, imageHeight);
      finish({
        centerX: 0.5 - offsetX / (imageWidth * baseScale * zoom),
        centerY: 0.5 - offsetY / (imageHeight * baseScale * zoom),
        zoom,
      });
    }, { signal: listeners.signal });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    }, { signal: listeners.signal });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    }, { capture: true, signal: listeners.signal });
    zoomSlider.addEventListener("input", () => {
      zoom = Number(zoomSlider.value);
      render();
    }, { signal: listeners.signal });
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const nextZoom = Math.max(1, Math.min(3, Math.round(zoom * Math.exp(-event.deltaY * 0.0015) * 100) / 100));
      if (nextZoom === zoom) return;
      const rect = viewport.getBoundingClientRect();
      const anchorX = Math.max(0, Math.min(PREVIEW_SIZE, event.clientX - rect.left));
      const anchorY = Math.max(0, Math.min(PREVIEW_SIZE, event.clientY - rect.top));
      const ratio = nextZoom / zoom;
      offsetX = (anchorX - PREVIEW_SIZE / 2) * (1 - ratio) + offsetX * ratio;
      offsetY = (anchorY - PREVIEW_SIZE / 2) * (1 - ratio) + offsetY * ratio;
      zoom = nextZoom;
      zoomSlider.value = String(zoom);
      render();
    }, { passive: false, signal: listeners.signal });
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX, offsetY };
    }, { signal: listeners.signal });
    viewport.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      offsetX = drag.offsetX + event.clientX - drag.x;
      offsetY = drag.offsetY + event.clientY - drag.y;
      render();
    }, { signal: listeners.signal });
    const endDrag = (): void => { drag = null; };
    viewport.addEventListener("pointerup", endDrag, { signal: listeners.signal });
    viewport.addEventListener("pointercancel", endDrag, { signal: listeners.signal });

    document.body.appendChild(overlay);
    render();
    save.focus();
  });
}
