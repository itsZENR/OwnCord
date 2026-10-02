import { createElement } from "@lib/dom";
import { voiceStore, type VoiceUser } from "@stores/voice.store";

export function formatSessionDuration(seconds: number): string {
  const elapsed = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  return [hours, minutes, elapsed % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

export function sessionDuration(startedAt: number | undefined, now = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt)) return "—";
  const serverNow = now + (voiceStore.getState().serverTimeOffsetMs ?? 0);
  return formatSessionDuration(serverNow / 1000 - startedAt);
}

export function getChannelSessionStart(users: Iterable<VoiceUser>): number | undefined {
  for (const user of users) {
    if (user.channelStartedAt && Number.isFinite(user.channelStartedAt)) return user.channelStartedAt;
  }
  return undefined;
}

export function createSessionTimer(startedAt: number | undefined, className: string, title: string): HTMLSpanElement {
  const timer = createElement("span", { class: className, title, "aria-label": title }, sessionDuration(startedAt));
  if (startedAt) timer.dataset.voiceSessionStart = String(startedAt);
  return timer;
}

/** Patch only timer text: never rebuild live previews or participant rows every second. */
export function refreshSessionTimers(root: Element): void {
  const now = Date.now();
  for (const timer of root.querySelectorAll<HTMLElement>("[data-voice-session-start]")) {
    timer.textContent = sessionDuration(Number(timer.dataset.voiceSessionStart), now);
  }
}
