// src/lib/platform/kvStore.ts
// Key-value settings. Tauri: Rust get_settings/save_settings. Web: one JSON
// blob in localStorage.
import { isTauri } from "./index";

const WEB_KEY = "owncord:settings";

function webReadAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(WEB_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getSettings(): Promise<Record<string, unknown>> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Record<string, unknown>>("get_settings");
  }
  return webReadAll();
}

export async function saveSettings(key: string, value: unknown): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_settings", { key, value });
    return;
  }
  const all = webReadAll();
  all[key] = value;
  localStorage.setItem(WEB_KEY, JSON.stringify(all));
}
