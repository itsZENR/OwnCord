import { t } from "@lib/i18n";
/**
 * ChatHeader — builds the channel header bar with name, topic, pins, and search.
 */

import { createElement, appendChildren, setText } from "@lib/dom";
import { createIcon } from "@lib/icons";
import { showUserProfile } from "@components/UserProfileDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatHeaderRefs {
  readonly hashEl: HTMLSpanElement;
  readonly nameEl: HTMLSpanElement;
  readonly topicEl: HTMLSpanElement;
}

export interface ChatHeaderOptions {
  readonly onTogglePins: () => void;
  readonly onSearchFocus?: () => void;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildChatHeader(
  opts: ChatHeaderOptions,
): { element: HTMLDivElement; refs: ChatHeaderRefs } {
  const header = createElement("div", { class: "chat-header", "data-testid": "chat-header" });
  const hash = createElement("span", { class: "ch-hash" }, "#");
  const nameEl = createElement("span", { class: "ch-name", "data-testid": "chat-header-name" }, "general");
  const divider = createElement("div", { class: "ch-divider" });
  const topicEl = createElement("span", { class: "ch-topic" }, "");

  const tools = createElement("div", { class: "ch-tools" });
  const pinBtn = createElement("button", {
    type: "button",
    class: "pin-btn",
    title: t("Pins", "Закреплённые сообщения"),
    "aria-label": t("Pins", "Закреплённые сообщения"),
    "data-testid": "pin-btn",
  });
  pinBtn.appendChild(createIcon("pin", 18));
  pinBtn.addEventListener("click", () => { opts.onTogglePins(); });
  const searchInput = createElement("input", {
    class: "search-input",
    type: "search",
    placeholder: t("Search...", "Поиск…"),
    // This field is a decorative trigger: focusing it opens the search UI and
    // immediately blurs (see below), so it never accepts typed input. Marking
    // it readonly makes browsers/password-managers skip autofill entirely —
    // autocomplete=off alone is unreliable (Chrome ignored it and injected the
    // logged-in username here in the web build; the desktop webview never did).
    readonly: "true",
    autocomplete: "off",
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-testid": "search-input",
  });
  if (opts.onSearchFocus !== undefined) {
    const onFocus = opts.onSearchFocus;
    searchInput.addEventListener("focus", () => {
      onFocus();
      (searchInput).blur();
    });
  }
  appendChildren(tools, searchInput, pinBtn);

  appendChildren(header, hash, nameEl, divider, topicEl, tools);
  return { element: header, refs: { hashEl: hash, nameEl, topicEl } };
}

// ---------------------------------------------------------------------------
// DM mode helper
// ---------------------------------------------------------------------------

export function updateChatHeaderForDm(
  refs: ChatHeaderRefs,
  recipient: { id?: number; username: string; status: string; avatar?: string | null } | null,
): void {
  refs.nameEl.removeAttribute("role");
  refs.nameEl.removeAttribute("tabindex");
  refs.nameEl.classList.remove("profile-link");
  refs.nameEl.onclick = null;
  refs.nameEl.onkeydown = null;
  if (recipient !== null) {
    setText(refs.hashEl, "@");
    setText(refs.nameEl, recipient.username);
    setText(refs.topicEl, recipient.status);
    if (recipient.id !== undefined) {
      const userId = recipient.id;
      refs.nameEl.setAttribute("role", "button");
      refs.nameEl.setAttribute("tabindex", "0");
      refs.nameEl.classList.add("profile-link");
      refs.nameEl.onclick = () => showUserProfile(userId, recipient);
      refs.nameEl.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        showUserProfile(userId, recipient);
      };
    }
  } else {
    setText(refs.hashEl, "#");
  }
}
