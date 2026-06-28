// src/lib/platform/http.ts
// Platform HTTP primitive. Tauri build uses plugin-http (bypasses self-signed
// certs in the webview). Web build uses native fetch (valid cert + same origin).
//
// Web note: cross-origin enrichment requests (YouTube oEmbed, OG metadata,
// external image fetches) are CORS-blocked in a real browser. Callers degrade
// gracefully on rejection — this is intended web behavior, not a bug.
import { isTauri } from "./index";

type TauriFetch = (input: string, init?: RequestInit) => Promise<Response>;

let tauriFetchFn: TauriFetch | null = null;
let loaded = false;

async function ensureTauriFetch(): Promise<TauriFetch> {
  if (!loaded) {
    const mod = await import("@tauri-apps/plugin-http");
    tauriFetchFn = mod.fetch as unknown as TauriFetch;
    loaded = true;
  }
  // tauriFetchFn is set whenever loaded is true and isTauri() was true.
  return tauriFetchFn as TauriFetch;
}

/** Convert a RequestInfo | URL to a plain string for the Tauri plugin-http. */
function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url; // Request
}

export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri()) {
    const f = await ensureTauriFetch();
    return f(toUrlString(input), init);
  }
  // Native fetch ignores the unknown `danger` property; no stripping needed.
  return globalThis.fetch(input, init);
}
