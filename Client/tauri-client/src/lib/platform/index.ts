// Central platform detection and selection for the OwnCord client.
// This is the ONLY place allowed to read the Tauri global.

/** True when running inside the Tauri webview (desktop build). */
export function isTauri(): boolean {
  return typeof globalThis !== "undefined"
    && "__TAURI_INTERNALS__" in (globalThis as object);
}

/**
 * Client version string. In the web build this is injected at build time via
 * Vite `define` (see Task 11). The fallback keeps unit tests and dev happy.
 */
declare const __APP_VERSION__: string | undefined;
export function getAppVersion(): string {
  try {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
  } catch {
    return "dev";
  }
}
