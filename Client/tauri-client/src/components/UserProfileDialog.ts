import { appendChildren, createElement, setText } from "@lib/dom";
import { t } from "@lib/i18n";
import { setAvatarVisual } from "@lib/avatar";
import { authStore } from "@stores/auth.store";
import { membersStore } from "@stores/members.store";
import { activityStore, formatVoiceTime } from "@stores/activity.store";
import { openSettings } from "@stores/ui.store";

interface ProfileFallback {
  username: string;
  avatar?: string | null;
  status?: string;
}

let closeActiveProfile: (() => void) | null = null;

async function copyUsername(username: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(username);
    return;
  }
  const field = createElement("textarea", { readonly: "true" });
  field.value = username;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy failed");
}

/** Open a member's public profile. The current user's profile opens Account settings. */
export function showUserProfile(userId: number, fallback?: ProfileFallback): void {
  closeActiveProfile?.();
  if (authStore.getState().user?.id === userId) {
    openSettings();
    return;
  }

  const member = membersStore.getState().members.get(userId);
  const username = member?.username ?? fallback?.username;
  if (!username) return;

  const previousFocus = document.activeElement;
  const listeners = new AbortController();
  const overlay = createElement("div", { class: "user-profile-overlay", "data-testid": "user-profile-dialog" });
  const card = createElement("div", {
    class: "user-profile-card", role: "dialog", "aria-modal": "true",
    "aria-label": t("User profile", "Профиль пользователя"),
  });
  const banner = createElement("div", { class: "user-profile-banner" });
  const closeButton = createElement("button", {
    class: "user-profile-close", type: "button", "aria-label": t("Close", "Закрыть"),
  }, "×");
  banner.appendChild(closeButton);
  const avatar = createElement("div", { class: "user-profile-avatar" });
  setAvatarVisual(avatar, username, member?.avatar ?? fallback?.avatar ?? null);
  const body = createElement("div", { class: "user-profile-body" });
  const name = createElement("h2", { "data-testid": "user-profile-name" }, username);
  const roleNames: Record<string, string> = {
    owner: t("Owner", "Владелец"), admin: t("Admin", "Администратор"),
    moderator: t("Moderator", "Модератор"), member: t("Member", "Участник"),
  };
  const statusNames: Record<string, string> = {
    online: t("Online", "В сети"), idle: t("Idle", "Неактивен"),
    dnd: t("Do not disturb", "Не беспокоить"), offline: t("Offline", "Не в сети"),
  };
  const role = createElement("div", { class: "user-profile-meta" },
    `${t("Role", "Роль")}: ${roleNames[member?.role ?? "member"] ?? member?.role}`);
  const status = createElement("div", { class: "user-profile-meta" },
    `${t("Status", "Статус")}: ${statusNames[(member?.status ?? fallback?.status ?? "").toLowerCase()] ?? t("Unknown", "Неизвестен")}`);
  const activity = activityStore.getState().members.get(userId);
  const voiceTime = createElement("div", { class: "user-profile-meta" },
    `${t("Voice time on server", "Время в голосовых каналах сервера")}: ${activity ? formatVoiceTime(activity.total_seconds) : "—"}`);
  const copyButton = createElement("button", {
    class: "ac-btn user-profile-copy", type: "button", "data-testid": "user-profile-copy",
  }, t("Copy username", "Скопировать ник"));
  const feedback = createElement("div", { class: "user-profile-feedback", role: "status" });
  appendChildren(body, name, role, status, voiceTime, copyButton, feedback);
  appendChildren(card, banner, avatar, body);
  overlay.appendChild(card);

  const close = (): void => {
    listeners.abort();
    overlay.remove();
    if (closeActiveProfile === close) closeActiveProfile = null;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  closeActiveProfile = close;
  closeButton.addEventListener("click", close, { signal: listeners.signal });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  }, { signal: listeners.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, { capture: true, signal: listeners.signal });
  copyButton.addEventListener("click", () => {
    void copyUsername(username).then(() => {
      setText(feedback, t("Username copied", "Ник скопирован"));
    }).catch(() => {
      setText(feedback, t("Could not copy username", "Не удалось скопировать ник"));
    });
  }, { signal: listeners.signal });

  document.body.appendChild(overlay);
  closeButton.focus();
}
