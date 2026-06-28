// Native-WebSocket transport for the web build. The valid TLS cert means no
// proxy and no TOFU — onCertMismatch is never invoked.
import type { WsTransport, CertTofuEvent } from "./wsTransport";
import { createLogger } from "../logger";

const log = createLogger("ws-transport-web");

export function createWebWsTransport(): WsTransport {
  let sock: WebSocket | null = null;
  let onMessageCb: ((raw: string) => void) | null = null;
  let onStateCb: ((open: boolean) => void) | null = null;
  let onErrorCb: ((err: unknown) => void) | null = null;

  return {
    connect(url: string): Promise<void> {
      sock = new WebSocket(url);
      sock.onopen = () => onStateCb?.(true);
      sock.onclose = () => onStateCb?.(false);
      sock.onerror = (e) => onErrorCb?.(e);
      sock.onmessage = (e: MessageEvent) => {
        if (typeof e.data === "string") onMessageCb?.(e.data);
      };
      return Promise.resolve();
    },
    send(message: string): void {
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(message);
      } else {
        log.warn("send called while socket not open");
      }
    },
    disconnect(): Promise<void> {
      if (sock) {
        sock.onclose = null; // suppress state callback on intentional close
        sock.close();
        sock = null;
      }
      return Promise.resolve();
    },
    onMessage(cb) { onMessageCb = cb; },
    onState(cb) { onStateCb = cb; },
    onError(cb) { onErrorCb = cb; },
    onCertMismatch(_cb: (event: CertTofuEvent) => void) { /* never fires on web */ },
    acceptCertFingerprint(): Promise<void> { return Promise.resolve(); },
  };
}
