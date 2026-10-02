import { createStore } from "@lib/store";
import type { ApiClient } from "@lib/api";
import { t } from "@lib/i18n";

export interface MemberActivity {
  readonly user_id: number;
  readonly total_seconds: number;
  readonly sessions: number;
  /** Lifetime seconds per persistent voice channel, keyed by channel id. */
  readonly channel_seconds?: Readonly<Record<string, number>>;
}
export const activityStore = createStore<{
  members: ReadonlyMap<number, MemberActivity>;
  loaded: boolean;
  error: string | null;
}>({ members: new Map(), loaded: false, error: null });

export function formatVoiceTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)} ${t("h", "ч")} ${minutes % 60} ${t("min", "мин")}`;
}

export function startActivitySync(api: ApiClient): { refresh(): Promise<void>; destroy(): void } {
  const controller = new AbortController();
  let pending = false;
  activityStore.setState(() => ({ members: new Map(), loaded: false, error: null }));
  async function refresh(): Promise<void> {
    if (pending || controller.signal.aborted) return;
    pending = true;
    try {
      const result = await api.getVoiceActivity(controller.signal);
      if (!controller.signal.aborted) activityStore.setState(() => ({
        members: new Map(result.members.map((m) => [m.user_id, m])), loaded: true, error: null,
      }));
    } catch {
      if (!controller.signal.aborted) activityStore.setState((s) => ({ ...s,
        error: t("Could not load activity. Retry or ask the administrator to update the server.", "Не удалось загрузить статистику. Повторите попытку или попросите администратора обновить сервер."),
      }));
    } finally { pending = false; }
  }
  void refresh();
  const timer = setInterval(() => { void refresh(); }, 30_000);
  return { refresh, destroy() { controller.abort(); clearInterval(timer); } };
}
