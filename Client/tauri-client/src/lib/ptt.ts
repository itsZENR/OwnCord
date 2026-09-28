/**
 * Push-to-Talk service — uses Rust-side GetAsyncKeyState polling so the
 * PTT key is NOT consumed/hijacked. Other apps and chat input continue
 * to receive the key normally. Works even when OwnCord is unfocused.
 */

import { loadPref, savePref } from "@components/settings/helpers";
import { voiceStore } from "@stores/voice.store";
import { setMuted } from "./livekitSession";
import { createLogger } from "./logger";
import { isTauri } from "./platform/index";

const log = createLogger("ptt");

let listening = false;
let unlistenPtt: (() => void) | null = null;
let activeChannelId: number | null = null;

const VK_TO_CODE: Record<number, string> = {
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [0x41 + i, `Key${String.fromCharCode(65 + i)}`])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [0x30 + i, `Digit${i}`])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [0x60 + i, `Numpad${i}`])),
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [0x70 + i, `F${i + 1}`])),
  0x08: "Backspace", 0x09: "Tab", 0x0D: "Enter", 0x1B: "Escape",
  0x20: "Space", 0x11: "ControlLeft", 0x10: "ShiftLeft", 0x12: "AltLeft",
  0x21: "PageUp", 0x22: "PageDown", 0x23: "End", 0x24: "Home",
  0x25: "ArrowLeft", 0x26: "ArrowUp", 0x27: "ArrowRight", 0x28: "ArrowDown",
  0x2D: "Insert", 0x2E: "Delete", 0xC0: "Backquote", 0xBD: "Minus",
  0xBB: "Equal", 0xDB: "BracketLeft", 0xDD: "BracketRight", 0xDC: "Backslash",
  0xBA: "Semicolon", 0xDE: "Quote", 0xBC: "Comma", 0xBE: "Period", 0xBF: "Slash",
};

// Web PTT only fires while the browser tab has focus (no OS-global hook).
let webKeyCode: string | undefined;
let webDown: ((e: KeyboardEvent) => void) | null = null;
let webUp: ((e: KeyboardEvent) => void) | null = null;

function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  );
}

function pressPtt(): void {
  const channelId = voiceStore.getState().currentChannelId;
  if (channelId === null || activeChannelId !== null) return;
  activeChannelId = channelId;
  setMuted(false);
}

function releasePtt(): void {
  const channelId = activeChannelId;
  activeChannelId = null;
  // An unrelated key release must never change microphone state.
  if (channelId !== null && channelId === voiceStore.getState().currentChannelId) setMuted(true);
}

function webInit(vk: number): void {
  webKeyCode = VK_TO_CODE[vk];
  if (!webKeyCode || webDown || webUp) return;
  webDown = (e: KeyboardEvent) => {
    const shortcut = (e.ctrlKey && vk !== 0x11) || (e.shiftKey && vk !== 0x10)
      || (e.altKey && vk !== 0x12) || e.metaKey;
    if (shortcut) { releasePtt(); return; }
    if (e.code !== webKeyCode) return;
    if (e.repeat || e.isComposing || isEditing(e.target) || isEditing(document.activeElement)) return;
    pressPtt();
  };
  webUp = (e: KeyboardEvent) => {
    if (e.code !== webKeyCode) return;
    releasePtt();
  };
  window.addEventListener("keydown", webDown);
  window.addEventListener("keyup", webUp);
  window.addEventListener("blur", releasePtt);
}

// Well-known virtual key code names for display
const VK_NAMES: ReadonlyMap<number, string> = new Map([
  [0x01, "Mouse Left"], [0x02, "Mouse Right"], [0x04, "Mouse Middle"],
  [0x05, "Mouse 4"], [0x06, "Mouse 5"],
  [0x08, "Backspace"], [0x09, "Tab"], [0x0D, "Enter"], [0x1B, "Escape"],
  [0x20, "Space"], [0x21, "Page Up"], [0x22, "Page Down"],
  [0x23, "End"], [0x24, "Home"],
  [0x25, "Arrow Left"], [0x26, "Arrow Up"], [0x27, "Arrow Right"], [0x28, "Arrow Down"],
  [0x2D, "Insert"], [0x2E, "Delete"],
  [0x70, "F1"], [0x71, "F2"], [0x72, "F3"], [0x73, "F4"],
  [0x74, "F5"], [0x75, "F6"], [0x76, "F7"], [0x77, "F8"],
  [0x78, "F9"], [0x79, "F10"], [0x7A, "F11"], [0x7B, "F12"],
  [0x7C, "F13"], [0x7D, "F14"], [0x7E, "F15"], [0x7F, "F16"],
  [0xC0, "`"], [0xBD, "-"], [0xBB, "="],
  [0xDB, "["], [0xDD, "]"], [0xDC, "\\"],
  [0xBA, ";"], [0xDE, "'"], [0xBC, ","], [0xBE, "."], [0xBF, "/"],
]);

/** Get a human-readable name for a virtual key code. */
export function vkName(vk: number): string {
  if (VK_NAMES.has(vk)) return VK_NAMES.get(vk)!;
  // 0-9 keys
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
  // A-Z keys
  if (vk >= 0x41 && vk <= 0x5A) return String.fromCharCode(vk);
  // Numpad 0-9
  if (vk >= 0x60 && vk <= 0x69) return `Numpad ${vk - 0x60}`;
  return `Key 0x${vk.toString(16).toUpperCase()}`;
}

/** Start listening for PTT state changes from the Rust backend. */
export async function initPtt(): Promise<void> {
  const vk = loadPref<number>("pttVk", 0);
  if (vk === 0) return;
  if (!isTauri()) { webInit(vk); return; }
  if (listening) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    await invoke("ptt_set_key", { vkCode: vk });

    unlistenPtt = await listen<boolean>("ptt-state", (event) => {
      if (!event.payload) { releasePtt(); return; }
      if (document.hasFocus() && isEditing(document.activeElement)) return;
      pressPtt();
    });
    await invoke("ptt_start");
    listening = true;
    log.info("PTT started", { vk, name: vkName(vk) });
  } catch (err) {
    unlistenPtt?.();
    unlistenPtt = null;
    // Not in Tauri environment (dev mode)
    log.debug("PTT not available", { error: err });
  }
}

/** Stop PTT polling. */
export async function stopPtt(): Promise<void> {
  releasePtt();
  if (!isTauri()) {
    if (webDown) window.removeEventListener("keydown", webDown);
    if (webUp) window.removeEventListener("keyup", webUp);
    window.removeEventListener("blur", releasePtt);
    webDown = webUp = null;
    webKeyCode = undefined;
    return;
  }
  unlistenPtt?.();
  unlistenPtt = null;
  if (!listening) return;
  listening = false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ptt_stop");
    log.info("PTT stopped");
  } catch {
    // ignore
  }
}

/** Update the PTT key and restart polling. */
export async function updatePttKey(vk: number): Promise<void> {
  savePref("pttVk", vk);
  releasePtt();
  if (!isTauri()) {
    await stopPtt();
    if (vk !== 0) webInit(vk);
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ptt_set_key", { vkCode: vk });
    if (!listening && vk !== 0) {
      await initPtt();
    }
    if (vk === 0) {
      await stopPtt();
    }
    log.info("PTT key updated", { vk, name: vk !== 0 ? vkName(vk) : "disabled" });
  } catch {
    // ignore
  }
}

/** Use Rust-side polling to capture the next key press (for the binding UI). */
export async function captureKeyPress(): Promise<number> {
  if (!isTauri()) {
    // Web: resolve the next keydown to a VK code via reverse lookup.
    return new Promise<number>((resolve) => {
      const onKey = (e: KeyboardEvent) => {
        window.removeEventListener("keydown", onKey);
        clearTimeout(timeout);
        const vk = Number(Object.keys(VK_TO_CODE).find((k) => VK_TO_CODE[Number(k)] === e.code)) || 0;
        resolve(vk);
      };
      const timeout = setTimeout(() => {
        window.removeEventListener("keydown", onKey);
        resolve(0);
      }, 10_000);
      window.addEventListener("keydown", onKey);
    });
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number>("ptt_listen_for_key");
}
