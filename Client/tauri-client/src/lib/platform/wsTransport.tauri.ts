// Tauri transport: proxies WSS through Rust (ws_connect/ws_send/ws_disconnect
// + events), preserving the existing self-signed-cert + TOFU behavior.
import type { WsTransport, CertTofuEvent } from "./wsTransport";
import { createLogger } from "../logger";

const log = createLogger("ws-transport-tauri");

/** Parse the stored fingerprint from the Rust cert-tofu message string. */
export function parseStoredFingerprint(message?: string): string | undefined {
  if (!message) return undefined;
  const match = /Stored:\s+(\S+)/.exec(message);
  return match?.[1];
}

export function createTauriWsTransport(): WsTransport {
  let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
  let listen: ((event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>) | null = null;
  const unsubs: Array<() => void> = [];
  let onMessageCb: ((raw: string) => void) | null = null;
  let onStateCb: ((open: boolean) => void) | null = null;
  let onErrorCb: ((err: unknown) => void) | null = null;
  let onCertCb: ((event: CertTofuEvent) => void) | null = null;

  async function ensure(): Promise<void> {
    if (invoke !== null) return;
    const core = await import("@tauri-apps/api/core");
    const event = await import("@tauri-apps/api/event");
    invoke = core.invoke;
    listen = event.listen;
    unsubs.push(await listen("ws-message", (e) => onMessageCb?.(e.payload as string)));
    unsubs.push(await listen("ws-state", (e) => {
      // The Rust proxy emits "connecting", "open", and "closed". Only the
      // terminal states drive the connection machine — treating the
      // transitional "connecting" as not-open would fire a spurious reconnect
      // (which then opens a duplicate proxy connection the server kicks,
      // producing an endless reconnect loop). Ignore anything but open/closed.
      const state = e.payload as string;
      if (state === "open") onStateCb?.(true);
      else if (state === "closed") onStateCb?.(false);
    }));
    unsubs.push(await listen("ws-error", (e) => onErrorCb?.(e.payload)));
    unsubs.push(await listen("cert-tofu", (e) => {
      const raw = e.payload as CertTofuEvent;
      if (raw.status === "mismatch") {
        onCertCb?.({ ...raw, storedFingerprint: parseStoredFingerprint(raw.message) });
      }
    }));
  }

  return {
    async connect(url: string): Promise<void> {
      await ensure();
      await invoke!("ws_connect", { url });
    },
    send(message: string): void {
      void invoke?.("ws_send", { message }).catch((err) => log.warn("ws_send failed", err));
    },
    async disconnect(): Promise<void> {
      try { await invoke?.("ws_disconnect"); } catch { /* safe to ignore */ }
      for (const u of unsubs) u();
      unsubs.length = 0;
      invoke = null;
      listen = null;
    },
    onMessage(cb) { onMessageCb = cb; },
    onState(cb) { onStateCb = cb; },
    onError(cb) { onErrorCb = cb; },
    onCertMismatch(cb) { onCertCb = cb; },
    async acceptCertFingerprint(host: string, fingerprint: string): Promise<void> {
      await ensure();
      await invoke!("accept_cert_fingerprint", { host, fingerprint });
    },
  };
}
