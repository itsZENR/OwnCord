import { createElement, appendChildren } from "@lib/dom";
import { createIcon } from "@lib/icons";
import { t } from "@lib/i18n";
import { createAchievements } from "@components/Achievements";
import { channelsStore } from "@stores/channels.store";

export function createWorkspaceNavigation(sidebar: Element, chat: HTMLElement, refresh: () => void) {
  const nav = createElement("nav", { class: "workspace-nav", "aria-label": t("Workspace", "Разделы сервера") });
  const conversation = createElement("button", { type: "button", class: "workspace-tab active", "aria-pressed": "true" }, t("Chat", "Общение"));
  conversation.prepend(createIcon("users", 17));
  const achievements = createElement("button", { type: "button", class: "workspace-tab", "aria-pressed": "false", "data-testid": "achievements-tab" }, t("Statistics", "Статистика"));
  achievements.prepend(createIcon("signal", 17));
  appendChildren(nav, conversation, achievements);
  sidebar.insertBefore(nav, sidebar.children[1] ?? null);
  const content = createElement("main", { class: "workspace-content" });
  const page = createAchievements(refresh);
  page.element.hidden = true;
  appendChildren(content, chat, page.element);
  function select(showAchievements: boolean): void {
    chat.hidden = showAchievements;
    page.element.hidden = !showAchievements;
    conversation.classList.toggle("active", !showAchievements);
    achievements.classList.toggle("active", showAchievements);
    conversation.setAttribute("aria-pressed", String(!showAchievements));
    achievements.setAttribute("aria-pressed", String(showAchievements));
    if (showAchievements) refresh();
  }
  conversation.addEventListener("click", () => select(false));
  achievements.addEventListener("click", () => select(true));
  const unsub = channelsStore.subscribeSelector((s) => s.activeChannelId, () => select(false));
  return { element: content, destroy() { unsub(); page.destroy(); nav.remove(); } };
}
