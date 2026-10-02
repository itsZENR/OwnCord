import { createElement, appendChildren } from "@lib/dom";
import { activityStore, formatVoiceTime } from "@stores/activity.store";
import { authStore } from "@stores/auth.store";
import { membersStore } from "@stores/members.store";
import { channelsStore } from "@stores/channels.store";
import { t } from "@lib/i18n";

/**
 * Server-wide voice statistics. The component keeps its old factory name so
 * workspace navigation and existing integrations do not need a breaking API
 * change; the UI intentionally contains no threshold-based achievements.
 */
export function createAchievements(onRetry: () => void): { element: HTMLElement; destroy(): void } {
  const expandedMembers = new Set<number>();
  const element = createElement("section", {
    class: "achievements-page statistics-page",
    "aria-label": t("Server statistics", "Статистика сервера"),
    "data-testid": "achievements-page",
  });

  function render(): void {
    for (const details of element.querySelectorAll<HTMLDetailsElement>("details[data-member-id]")) {
      const userId = Number(details.dataset.memberId);
      if (details.open) expandedMembers.add(userId);
      else expandedMembers.delete(userId);
    }
    element.replaceChildren();
    const state = activityStore.getState();
    const currentUserId = authStore.getState().user?.id ?? 0;
    const current = state.members.get(currentUserId);
    const members = membersStore.getState().members;

    const hero = createElement("div", { class: "achievement-hero statistics-hero" });
    appendChildren(hero,
      createElement("span", { class: "eyebrow" }, t("SERVER VOICE TIME", "ГОЛОСОВОЕ ВРЕМЯ СЕРВЕРА")),
      createElement("h1", {}, t("Time together, visible to everyone", "Общее время на сервере видно всем")),
      createElement("p", {}, t(
        "This is the total time each member has spent in this server's voice channels. It is a profile stat, not a locked achievement.",
        "Здесь отображается, сколько каждый участник провёл в голосовых каналах этого сервера. Это статистика профиля, а не набор закрытых достижений.",
      )),
    );
    element.appendChild(hero);

    if (state.error) {
      const error = createElement("div", { class: "activity-error", role: "alert" }, state.error);
      const retry = createElement("button", { type: "button", class: "btn-primary" }, t("Retry", "Повторить"));
      retry.addEventListener("click", onRetry);
      appendChildren(element, error, retry);
      return;
    }
    if (!state.loaded) {
      element.appendChild(createElement("p", { role: "status" }, t("Loading statistics…", "Загружаем статистику…")));
      return;
    }

    const ranked = [...members.values()]
      .map((member) => ({ member, activity: state.members.get(member.id) }))
      .sort((a, b) => (b.activity?.total_seconds ?? 0) - (a.activity?.total_seconds ?? 0)
        || a.member.username.localeCompare(b.member.username));
    const currentRank = ranked.findIndex(({ member }) => member.id === currentUserId) + 1;

    const metrics = createElement("div", { class: "achievement-metrics statistics-metrics" });
    for (const [value, label] of [
      [formatVoiceTime(current?.total_seconds ?? 0), t("your voice time", "ваше голосовое время")],
      [String(current?.sessions ?? 0), t("voice sessions", "голосовых подключений")],
      [currentRank > 0 ? `#${currentRank}` : "—", t("server ranking", "место на сервере")],
    ]) {
      const card = createElement("div", { class: "achievement-metric" });
      appendChildren(card, createElement("strong", {}, value), createElement("span", {}, label));
      metrics.appendChild(card);
    }
    element.appendChild(metrics);

    element.appendChild(createElement("h2", { class: "activity-title" }, t("Server voice time", "Голосовое время участников")));
    const board = createElement("div", { class: "activity-board", role: "list" });
    for (const [index, { member, activity }] of ranked.entries()) {
      const seconds = activity?.total_seconds ?? 0;
      const row = createElement("div", {
        class: `activity-board-row${member.id === currentUserId ? " current" : ""}`,
        role: "listitem",
      });
      const avatar = createElement("span", { class: "activity-board-avatar", "aria-hidden": "true" }, member.username.charAt(0).toUpperCase() || "?");
      const info = createElement("div", { class: "activity-board-member" });
      appendChildren(info,
        createElement("strong", {}, member.username),
        createElement("small", {}, activity
          ? `${activity.sessions} ${t("sessions", "подключений")}`
          : t("No voice sessions yet", "Пока без голосовых подключений")),
      );
      const channels = Object.entries(activity?.channel_seconds ?? {}).sort((a, b) => b[1] - a[1]);
      if (channels.length) {
        const details = createElement("details", { class: "activity-channel-details", "data-member-id": String(member.id) });
        details.open = expandedMembers.has(member.id);
        details.appendChild(createElement("summary", {}, t("Total time by channel", "Накопленное время по каналам")));
        const breakdown = createElement("dl", { class: "activity-channel-times" });
        for (const [channelId, seconds] of channels) {
          const name = channelsStore.getState().channels.get(Number(channelId))?.name
            ?? `${t("Channel", "Канал")} #${channelId}`;
          appendChildren(breakdown,
            createElement("dt", {}, name),
            createElement("dd", {}, formatVoiceTime(seconds)),
          );
        }
        details.appendChild(breakdown);
        info.appendChild(details);
      }
      appendChildren(row,
        createElement("span", { class: "activity-rank" }, String(index + 1)),
        avatar,
        info,
        createElement("strong", { class: "activity-board-time", title: formatVoiceTime(seconds) }, formatVoiceTime(seconds)),
      );
      board.appendChild(row);
    }
    if (!ranked.length) board.appendChild(createElement("p", {}, t("There are no members to show yet.", "Пока нет участников для отображения.")));
    element.appendChild(board);
    element.appendChild(createElement("p", { class: "activity-note" }, t(
      "Voice time is cumulative for this server and includes muted time. Private calls are excluded. The numbers refresh every 30 seconds.",
      "Время накапливается только на этом сервере и включает время с выключенным микрофоном. Личные звонки не учитываются. Статистика обновляется каждые 30 секунд.",
    )));
  }

  const unsubActivity = activityStore.subscribe(render);
  const unsubMembers = membersStore.subscribeSelector((s) => s.members, render);
  const unsubChannels = channelsStore.subscribeSelector((s) => s.channels, render);
  render();
  return {
    element,
    destroy() {
      unsubActivity();
      unsubMembers();
      unsubChannels();
      element.remove();
    },
  };
}
