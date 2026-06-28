/**
 * Credential storage — wraps Tauri IPC commands for Windows Credential Manager.
 * Falls back to no-op in non-Tauri environments (tests, browser).
 */

import { createLogger } from "./logger";
import { isTauri } from "./platform/index";

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
): Promise<boolean> {
  if (!isTauri()) {
    // Web: persist username + token only (no password auto-login in a browser).
    // localStorage is weaker than the desktop OS store; token is revocable.
    try {
      localStorage.setItem(webKey(host), JSON.stringify({ username, token }));
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

/**
 * Load a credential from Windows Credential Manager.
 * Returns null if not found or Tauri unavailable.
 */
export async function loadCredential(
  host: string,
): Promise<SavedCredential | null> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem(webKey(host));
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

/**
 * Delete a credential from Windows Credential Manager.
 */
export async function deleteCredential(host: string): Promise<boolean> {
  if (!isTauri()) {
    try {
      localStorage.removeItem(webKey(host));
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
