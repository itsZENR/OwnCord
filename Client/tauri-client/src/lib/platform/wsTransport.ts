import { isTauri } from "./index";

/** TOFU certificate event emitted by the Rust WS proxy (Tauri only). */
export interface CertTofuEvent {
  readonly host: string;
  readonly fingerprint: string;
  readonly status: "trusted_first_use" | "trusted" | "mismatch";
  readonly message?: string;
  readonly storedFingerprint?: string;
}

export interface WsTransport {
  connect(url: string): Promise<void>;
  send(message: string): void;
  disconnect(): Promise<void>;
  onMessage(cb: (raw: string) => void): void;
  onState(cb: (open: boolean) => void): void;
  onError(cb: (err: unknown) => void): void;
  /** TOFU cert mismatch — Tauri only; web transport never calls this. */
  onCertMismatch(cb: (event: CertTofuEvent) => void): void;
  acceptCertFingerprint(host: string, fingerprint: string): Promise<void>;
}

export async function createWsTransport(): Promise<WsTransport> {
  if (isTauri()) {
    const { createTauriWsTransport } = await import("./wsTransport.tauri");
    return createTauriWsTransport();
  }
  const { createWebWsTransport } = await import("./wsTransport.web");
  return createWebWsTransport();
}

/** Re-export for consumers that only need the helper, not the full transport. */
export { parseStoredFingerprint } from "./wsTransport.tauri";
