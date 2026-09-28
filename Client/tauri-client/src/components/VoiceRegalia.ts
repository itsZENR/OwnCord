import { createElement } from "@lib/dom";
import { t } from "@lib/i18n";
import { activityStore, formatVoiceTime } from "@stores/activity.store";

/**
 * Compact server-wide voice time shown next to a user's avatar.
 *
 * The activity endpoint is available to every authenticated member, so this
 * is deliberately a public profile stat rather than an achievement state.
 */
export function formatVoiceBadge(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes} ${t("min", "мин")}`;
  return `${Math.floor(minutes / 60)} ${t("h", "ч")}`;
}

export function createVoiceRegalia(userId: number): HTMLSpanElement | null {
  const state = activityStore.getState();
  if (!state.loaded || state.error !== null) return null;

  const seconds = state.members.get(userId)?.total_seconds ?? 0;
  const label = t("Voice time on this server", "Голосовое время на сервере");
  return createElement("span", {
    class: "voice-regalia",
    title: `${label}: ${formatVoiceTime(seconds)}`,
    "aria-label": `${label}: ${formatVoiceTime(seconds)}`,
  }, formatVoiceBadge(seconds));
}
