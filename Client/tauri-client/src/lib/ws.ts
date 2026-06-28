// Step 2.15 — WebSocket Client
// Transport-agnostic: delegates raw WS operations to a WsTransport selected
// at runtime (Tauri proxy for desktop, native WebSocket for web).

import type { ServerMessage, ClientMessage } from "./types";
import { createLogger } from "./logger";
import { createWsTransport } from "./platform/wsTransport";
import type { WsTransport, CertTofuEvent } from "./platform/wsTransport";

const log = createLogger("ws");

// Re-export transport types so existing importers of @lib/ws stay unaffected.
export type { CertTofuEvent } from "./platform/wsTransport";
export { parseStoredFingerprint } from "./platform/wsTransport";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting";

export type WsListener<T extends ServerMessage["type"]> = (
  payload: Extract<ServerMessage, { type: T }>["payload"],
  id?: string,
) => void;

export type CertMismatchListener = (event: CertTofuEvent) => void;

export interface WsClientConfig {
  readonly host: string;
  readonly token: string;
  readonly maxReconnectDelayMs?: number;
  readonly maxMessageSizeBytes?: number;
}

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_MAX_MESSAGE_SIZE = 1_048_576; // 1MB
const HEARTBEAT_INTERVAL_MS = 30_000;

function uuid(): string {
  return crypto.randomUUID();
}

export function createWsClient() {
  let config: WsClientConfig | null = null;
  let state: ConnectionState = "disconnected";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let intentionalClose = false;
  let certMismatchBlock = false; // blocks reconnect on TOFU mismatch
  let proxyOpen = false;
  let lastSeq = 0;

  // Deduplication cache for reconnection replay.
  // Active when reconnecting (reconnectAttempt > 0) until auth_ok.
  let replayDedup: Set<string> | null = null;
  const MAX_DEDUP_SIZE = 1000;

  // Transport — created on first connect(), reused across reconnects.
  let transport: WsTransport | null = null;

  // Type-safe listener registry
  const listeners = new Map<string, Set<WsListener<ServerMessage["type"]>>>();

  // State change listeners
  const stateListeners = new Set<(state: ConnectionState) => void>();

  // TOFU cert mismatch listeners
  const certMismatchListeners = new Set<CertMismatchListener>();

  function setState(newState: ConnectionState): void {
    if (state !== newState) {
      state = newState;
      for (const listener of stateListeners) {
        try {
          listener(state);
        } catch (err) {
          log.error("State listener error", err);
        }
      }
    }
  }

  function getReconnectDelay(): number {
    const maxDelay = config?.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY;
    return Math.min(1000 * Math.pow(2, reconnectAttempt), maxDelay);
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (proxyOpen) {
        try {
          sendRaw(JSON.stringify({ type: "ping", payload: {} }));
        } catch {
          // Connection may have dropped
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (intentionalClose || certMismatchBlock || !config) return;
    const delay = getReconnectDelay();
    log.info("WebSocket reconnecting", {
      delayMs: delay,
      attempt: reconnectAttempt + 1,
      host: config?.host ?? "unknown",
      lastSeq,
    });
    setState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectAttempt++;
      void connect(config!);
    }, delay);
  }

  function cancelReconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function handleMessage(raw: string): void {
    const maxSize = config?.maxMessageSizeBytes ?? DEFAULT_MAX_MESSAGE_SIZE;

    if (raw.length > maxSize) {
      log.warn("Message exceeds size limit, dropping", { size: raw.length });
      return;
    }

    let parsed: { type?: string; payload?: unknown; id?: string; seq?: number };
    try {
      parsed = JSON.parse(raw) as { type?: string; payload?: unknown; id?: string; seq?: number };
    } catch {
      log.warn("Failed to parse WS message", { data: raw });
      return;
    }

    // Track the highest sequence number for reconnection replay.
    const seq = typeof parsed.seq === "number" ? parsed.seq : 0;
    if (seq > lastSeq) {
      lastSeq = seq;
    }

    // Server pong messages have no payload — silently ignore.
    if (parsed.type === "pong") return;

    if (!parsed.type || parsed.payload === undefined) {
      log.warn("Invalid WS message: missing type or payload", { parsed });
      return;
    }

    const msg = parsed as unknown as ServerMessage;

    log.debug("WS ←", { type: msg.type, id: msg.id });

    // Deduplication during reconnection replay
    if (replayDedup !== null && msg.type !== "auth_ok" && msg.type !== "auth_error" && msg.type !== "ready") {
      const dedupKey = msg.id ?? `${msg.type}:${seq}`;
      if (replayDedup.has(dedupKey)) {
        log.debug("Dedup: skipping duplicate message", { type: msg.type, key: dedupKey });
        return;
      }
      replayDedup.add(dedupKey);
      // Evict oldest entries if set is too large
      if (replayDedup.size > MAX_DEDUP_SIZE) {
        const first = replayDedup.values().next().value;
        if (first !== undefined) replayDedup.delete(first);
      }
    }

    // auth_error — non-recoverable
    if (msg.type === "auth_error") {
      log.error("Authentication failed", { message: msg.payload.message });
      intentionalClose = true;
      dispatch(msg);
      void disconnectTransport();
      setState("disconnected");
      return;
    }

    // auth_ok — mark as connected
    if (msg.type === "auth_ok") {
      if (reconnectAttempt > 0) {
        log.info("WebSocket reconnected successfully", {
          afterAttempts: reconnectAttempt,
          host: config?.host ?? "unknown",
          lastSeq,
        });
      }
      // Clear dedup cache — replay is complete
      replayDedup = null;
      setState("connected");
      reconnectAttempt = 0;
      startHeartbeat();
    }

    dispatch(msg);
  }

  function dispatch(msg: ServerMessage): void {
    const typeListeners = listeners.get(msg.type);
    if (!typeListeners || typeListeners.size === 0) {
      log.debug("WS dispatch: no listeners", { type: msg.type });
      return;
    }
    for (const listener of typeListeners) {
      try {
        (listener)(
          msg.payload,
          msg.id,
        );
      } catch (err) {
        log.error(`Listener error for ${msg.type}`, err);
      }
    }
  }

  async function connect(cfg: WsClientConfig): Promise<void> {
    config = cfg;
    intentionalClose = false;
    cancelReconnect();

    setState("connecting");

    const wsUrl = `wss://${cfg.host}/api/v1/ws`;
    log.info("WebSocket connecting", {
      url: wsUrl,
      isReconnect: reconnectAttempt > 0,
      attempt: reconnectAttempt,
    });

    // Create transport and register callbacks once on first connect.
    if (transport === null) {
      transport = await createWsTransport();

      transport.onMessage(handleMessage);

      transport.onState((open) => {
        log.debug("WS transport state", { open });
        if (open) {
          proxyOpen = true;
          log.info("WebSocket open, sending auth", {
            host: config?.host ?? "unknown",
            isReconnect: reconnectAttempt > 0,
            lastSeq,
          });
          // Enable dedup during reconnection replay
          if (reconnectAttempt > 0 && lastSeq > 0) {
            replayDedup = new Set();
          }
          setState("authenticating");
          if (config === null) return;
          send({ type: "auth", payload: { token: config.token, last_seq: lastSeq } });
        } else {
          proxyOpen = false;
          log.info("WebSocket closed", {
            host: config?.host ?? "unknown",
            intentional: intentionalClose,
            certBlocked: certMismatchBlock,
          });
          stopHeartbeat();
          if (!intentionalClose) {
            scheduleReconnect();
          } else {
            setState("disconnected");
          }
        }
      });

      transport.onError((err) => {
        log.warn("WebSocket error (proxy)", { error: err });
      });

      transport.onCertMismatch((evt) => {
        log.info("TOFU cert event", { host: evt.host, status: evt.status });
        log.error("Certificate fingerprint mismatch!", {
          host: evt.host,
          fingerprint: evt.fingerprint,
          storedFingerprint: evt.storedFingerprint,
        });
        certMismatchBlock = true;
        setState("disconnected");
        for (const listener of certMismatchListeners) {
          listener(evt);
        }
      });
    }

    try {
      await transport.connect(wsUrl);
    } catch (err) {
      log.error("ws_connect failed", err);
      proxyOpen = false;

      // Cert mismatch is handled by the onCertMismatch callback
      // (which sets certMismatchBlock before this catch runs).
      // scheduleReconnect() checks certMismatchBlock and will no-op if set.
      scheduleReconnect();
    }
  }

  function sendRaw(json: string): void {
    if (transport === null || !proxyOpen) {
      log.warn("Cannot send, WebSocket not open");
      return;
    }
    transport.send(json);
  }

  function send(msg: ClientMessage | { type: string; payload: unknown }): string {
    const id = uuid();
    const envelope = { ...msg, id };
    log.debug("WS →", { type: msg.type, id });
    sendRaw(JSON.stringify(envelope));
    return id;
  }

  async function disconnectTransport(): Promise<void> {
    // Capture and null out immediately so the next connect() creates a fresh
    // transport (with fresh Tauri event subscriptions) rather than reusing one
    // whose subscriptions are being torn down concurrently.
    const t = transport;
    transport = null;
    if (t !== null) {
      await t.disconnect();
    }
    proxyOpen = false;
  }

  function disconnect(): void {
    intentionalClose = true;
    log.info("WebSocket disconnecting (intentional)", { host: config?.host ?? "unknown" });
    certMismatchBlock = false;
    cancelReconnect();
    stopHeartbeat();
    void disconnectTransport();
    setState("disconnected");
    // Reset lastSeq — disconnect() is only called for intentional close
    // (logout). Automatic reconnects go through scheduleReconnect() which
    // preserves lastSeq for server-side event replay.
    lastSeq = 0;
  }

  return {
    connect(cfg: WsClientConfig): void {
      void connect(cfg);
    },

    disconnect,

    send(msg: ClientMessage): string {
      return send(msg);
    },

    on<T extends ServerMessage["type"]>(
      type: T,
      listener: WsListener<T>,
    ): () => void {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      const set = listeners.get(type)!;
      set.add(listener as unknown as WsListener<ServerMessage["type"]>);
      return () => {
        set.delete(listener as unknown as WsListener<ServerMessage["type"]>);
      };
    },

    onStateChange(listener: (state: ConnectionState) => void): () => void {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    /** Register a listener for TOFU certificate mismatch events. */
    onCertMismatch(listener: CertMismatchListener): () => void {
      certMismatchListeners.add(listener);
      return () => certMismatchListeners.delete(listener);
    },

    /**
     * Accept a changed certificate fingerprint for a host.
     * Call after the user acknowledges a cert mismatch warning,
     * then reconnect.
     */
    async acceptCertFingerprint(host: string, fingerprint: string): Promise<void> {
      if (transport === null) {
        throw new Error("Transport not initialized");
      }
      await transport.acceptCertFingerprint(host, fingerprint);
      certMismatchBlock = false;
      log.info("Accepted new cert fingerprint", { host });
    },

    getState(): ConnectionState {
      return state;
    },

    /** True while processing reconnection replay messages (dedup active). */
    isReplaying(): boolean {
      return replayDedup !== null;
    },

    /** @internal for testing */
    _getWs(): WebSocket | null {
      return null;
    },
  };
}

export type WsClient = ReturnType<typeof createWsClient>;
