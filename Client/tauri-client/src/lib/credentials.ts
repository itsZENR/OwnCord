/**
 * Credential storage — wraps Tauri IPC commands for Windows Credential Manager.
 * Falls back to no-op in non-Tauri environments (tests, browser).
 */

import { createLogger } from "./logger";
import { isTauri } from "./platform/index";
import { normalizeServerAddress } from "./serverAddress";

const log = createLogger("credentials");

export interface SavedCredential {
  readonly username: string;
  readonly token: string;
  readonly password?: string;
}

const webKey = (host: string) => `owncord:cred:${host}`;

/** Dynamically import Tauri invoke to avoid errors in test/browser. */
async function getInvoke(): Promise<
  ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null
> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  } catch {
    return null;
  }
}

/**
 * Save a credential to Windows Credential Manager.
 * Target: OwnCord/{host}
 */
export async function saveCredential(
  host: string,
  username: string,
  token: string,
  password?: string,
  persist = true,
): Promise<boolean> {
  host = normalizeServerAddress(host);
  if (!isTauri()) {
    // Web: persist username + token only (no password auto-login in a browser).
    // localStorage is weaker than the desktop OS store; token is revocable.
    try {
      const storage = persist ? localStorage : sessionStorage;
      storage.setItem(webKey(host), JSON.stringify({ username, token }));
      (persist ? sessionStorage : localStorage).removeItem(webKey(host));
      return true;
    } catch {
      return false;
    }
  }
  // A non-persistent desktop login must not leave an old Windows credential
  // behind. The active token remains in memory for the current session.
  if (!persist) {
    try {
      await invokeDeleteCredential(host);
      return true;
    } catch {
      return false;
    }
  }
  const invoke = await getInvoke();
  if (!invoke) {
    log.warn("Tauri not available — credential not saved");
    return false;
  }
  try {
    await invoke("save_credential", { host, username, token, password: password ?? null });
    return true;
  } catch (err) {
    log.error("Failed to save credential", { host, error: String(err) });
    return false;
  }
}

async function invokeDeleteCredential(host: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Tauri is not available");
  await invoke("delete_credential", { host });
}

/**
 * Load a credential from Windows Credential Manager.
 * Returns null if not found or Tauri unavailable.
 */
export async function loadCredential(
  host: string,
): Promise<SavedCredential | null> {
  host = normalizeServerAddress(host);
  if (!isTauri()) {
    try {
      const raw = sessionStorage.getItem(webKey(host)) ?? localStorage.getItem(webKey(host));
      if (!raw) return null;
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (typeof o.username === "string" && typeof o.token === "string") {
        return { username: o.username, token: o.token };
      }
      return null;
    } catch {
      return null;
    }
  }
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  try {
    const result = await invoke("load_credential", { host });
    if (result && typeof result === "object") {
      const cred = result as Record<string, unknown>;
      if (typeof cred.username === "string" && typeof cred.token === "string") {
        return {
          username: cred.username,
          token: cred.token,
          ...(typeof cred.password === "string" ? { password: cred.password } : {}),
        };
      }
    }
    return null;
  } catch (err) {
    log.error("Failed to load credential", { host, error: String(err) });
    return null;
  }
}

/** Preserve the saved token/password and persistence choice after a rename. */
export async function updateSavedUsername(host: string, oldUsername: string, newUsername: string): Promise<boolean> {
  host = normalizeServerAddress(host);
  if (!isTauri()) {
    try {
      for (const storage of [localStorage, sessionStorage]) {
        const raw = storage.getItem(webKey(host));
        if (!raw) continue;
        const saved = JSON.parse(raw) as Record<string, unknown>;
        if (typeof saved.username !== "string" || saved.username.toLowerCase() !== oldUsername.toLowerCase()) continue;
        storage.setItem(webKey(host), JSON.stringify({ ...saved, username: newUsername }));
      }
      return true;
    } catch {
      return false;
    }
  }
  const saved = await loadCredential(host);
  if (!saved || saved.username.toLowerCase() !== oldUsername.toLowerCase()) return true;
  return saveCredential(host, newUsername, saved.token, saved.password);
}

/**
 * Delete a credential from Windows Credential Manager.
 */
export async function deleteCredential(host: string): Promise<boolean> {
  host = normalizeServerAddress(host);
  if (!isTauri()) {
    try {
      localStorage.removeItem(webKey(host));
      sessionStorage.removeItem(webKey(host));
      return true;
    } catch {
      return false;
    }
  }
  const invoke = await getInvoke();
  if (!invoke) {
    return false;
  }
  try {
    await invoke("delete_credential", { host });
    return true;
  } catch (err) {
    log.error("Failed to delete credential", { host, error: String(err) });
    return false;
  }
}
