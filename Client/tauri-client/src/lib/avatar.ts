/** Render a server-hosted avatar, including on desktop with a self-signed TLS certificate. */
import { fetchImageAsDataUrl, resolveServerUrl } from "@components/message-list/attachments";
import { isTauri } from "@lib/platform/index";

const AVATAR_PATH = /^\/api\/v1\/files\/[0-9a-f-]{36}$/i;

export function setAvatarVisual(container: HTMLElement, username: string, avatar: string | null): void {
  for (const node of [...container.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE ||
      (node instanceof HTMLElement && node.classList.contains("avatar-image"))) {
      node.remove();
    }
  }
  const initial = username.charAt(0).toUpperCase() || "?";
  const fallback = document.createTextNode(initial);
  container.prepend(fallback);
  container.dataset.avatarSource = avatar ?? "";
  if (!avatar || (!AVATAR_PATH.test(avatar) && !/^https?:\/\//i.test(avatar))) return;

  const url = resolveServerUrl(avatar);
  const show = (src: string): void => {
    if (container.dataset.avatarSource !== avatar) return;
    const img = document.createElement("img");
    img.className = "avatar-image";
    img.alt = username;
    img.onerror = () => {
      img.remove();
      if (!fallback.isConnected) container.prepend(fallback);
    };
    img.src = src;
    container.prepend(img);
    fallback.remove();
  };

  if (isTauri() && AVATAR_PATH.test(avatar)) {
    void fetchImageAsDataUrl(url).then((src) => {
      if (src !== null) show(src);
    }).catch(() => { /* Keep the initial when the image cannot be loaded. */ });
  } else {
    show(url);
  }
}
