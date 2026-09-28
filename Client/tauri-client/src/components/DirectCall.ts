import { createElement, appendChildren } from "@lib/dom";
import { createIcon } from "@lib/icons";
import { t } from "@lib/i18n";
import type { WsClient } from "@lib/ws";
import type { DirectCallPayload } from "@lib/types";
import { authStore } from "@stores/auth.store";
import { channelsStore } from "@stores/channels.store";
import { dmStore } from "@stores/dm.store";
import { voiceStore, joinVoiceChannel, leaveVoiceChannel } from "@stores/voice.store";
import { leaveVoice } from "@lib/livekitSession";
import { primeVoiceAudio } from "@lib/voiceSounds";
import { showToast } from "@lib/toast";
import { notifyIncomingCall } from "@lib/notifications";

export function createDirectCall(ws: WsClient, header: Element) {
  let call: DirectCallPayload | null = null;
  let starting = false;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const ac = new AbortController();
  const element = createElement("section", { class: "direct-call", role: "region", "aria-label": t("Private call", "Личный звонок"), hidden: "" });
  const start = createElement("button", { type: "button", class: "direct-call-start", title: t("Call", "Позвонить"), "aria-label": t("Call", "Позвонить"), "data-testid": "call-start" });
  start.appendChild(createIcon("phone", 18));
  header.prepend(start);
  function updateButton(): void {
    const channelId = channelsStore.getState().activeChannelId;
    start.hidden = !dmStore.getState().channels.some((dm) => dm.channelId === channelId);
    start.disabled = call !== null || starting || voiceStore.getState().currentChannelId !== null;
    start.title = start.disabled ? t("End the current voice session before calling", "Завершите текущее голосовое подключение перед звонком") : t("Call", "Позвонить");
  }
  start.addEventListener("click", () => {
    const channelId = channelsStore.getState().activeChannelId;
    if (!channelId || start.disabled) return;
    primeVoiceAudio();
    starting = true;
    updateButton();
    ws.send({ type: "call_start", payload: { channel_id: channelId } });
    startTimer = setTimeout(() => {
      if (starting) showToast(t("The server did not answer the call request. Try again or ask the administrator to update the server.", "Сервер не ответил на запрос звонка. Повторите попытку или попросите администратора обновить сервер."), "error");
      starting = false; updateButton();
    }, 10_000);
  }, { signal: ac.signal });

  function render(): void {
    element.replaceChildren();
    element.hidden = call === null;
    updateButton();
    if (!call) return;
    const current = call;
    const incoming = current.recipient_id === authStore.getState().user?.id;
    const label = current.state === "active" ? t("Private call", "Личный звонок")
      : incoming ? t("Incoming call", "Входящий звонок") : t("Calling…", "Вызываем…");
    const info = createElement("div", { class: "direct-call-info", role: "status" });
    appendChildren(info, createElement("strong", {}, incoming ? current.caller_name : current.recipient_name), createElement("span", {}, label));
    const avatar = createElement("div", { class: "direct-call-avatar" }, (incoming ? current.caller_name : current.recipient_name).slice(0, 1).toUpperCase());
    appendChildren(element, avatar, info);
    if (incoming && current.state === "ringing") {
      const accept = createElement("button", { type: "button", class: "call-accept", "data-testid": "call-accept" }, t("Accept", "Принять"));
      accept.addEventListener("click", () => {
        primeVoiceAudio(); accept.disabled = true;
        ws.send({ type: "call_accept", payload: { id: current.id } });
      });
      element.appendChild(accept);
    }
    const end = createElement("button", { type: "button", class: "call-end", "data-testid": "call-end" }, current.state === "active" ? t("End call", "Завершить") : incoming ? t("Decline", "Отклонить") : t("Cancel", "Отменить"));
    end.addEventListener("click", () => {
      end.disabled = true;
      ws.send({ type: "call_end", payload: { id: current.id } });
      if (current.state === "active") { leaveVoice(false); leaveVoiceChannel(); }
    });
    element.appendChild(end);
  }

  const unsubs = [
    ws.on("call_state", (payload) => {
      starting = false; clearTimeout(startTimer);
      if (payload.state === "ended") {
        if (call && call.id !== payload.id) return;
        if (call?.state === "active" || voiceStore.getState().currentChannelId === payload.channel_id) { leaveVoice(false); leaveVoiceChannel(); }
        call = null;
        const reasons = {
          missed: t("No answer", "Нет ответа"), declined: t("Call declined", "Звонок отклонён"),
          cancelled: t("Call cancelled", "Звонок отменён"), ended: t("Call ended", "Звонок завершён"),
          busy: t("Recipient is busy", "Собеседник занят"), failed: t("Could not connect the call. Try again.", "Не удалось подключить звонок. Повторите попытку."),
        };
        showToast(reasons[payload.reason ?? "ended"], payload.reason === "failed" ? "error" : "info");
      } else {
        if (payload.state === "ringing" && payload.recipient_id === authStore.getState().user?.id && call?.id !== payload.id) notifyIncomingCall(payload.caller_name);
        call = payload;
        if (payload.state === "active" && voiceStore.getState().currentChannelId !== payload.channel_id) joinVoiceChannel(payload.channel_id);
      }
      render();
    }),
    ws.on("error", () => { starting = false; clearTimeout(startTimer); updateButton(); }),
    ws.on("ready", () => { ws.send({ type: "call_sync", payload: {} }); }),
    ws.onStateChange((state) => {
      if (state === "reconnecting" || state === "disconnected") {
        call = null; starting = false; clearTimeout(startTimer); render();
      }
    }),
    channelsStore.subscribeSelector((s) => s.activeChannelId, updateButton),
    dmStore.subscribe(updateButton),
    voiceStore.subscribeSelector((s) => s.currentChannelId, updateButton),
  ];
  // Short-lived private-call JWTs are refreshed for future reconnects.
  const refreshTimer = setInterval(() => {
    if (call?.state === "active") ws.send({ type: "voice_token_refresh", payload: {} });
  }, 65_000);
  updateButton();
  ws.send({ type: "call_sync", payload: {} });
  return { element, destroy() {
    ac.abort(); clearTimeout(startTimer); clearInterval(refreshTimer);
    for (const unsub of unsubs) unsub();
    start.remove(); element.remove();
  } };
}
