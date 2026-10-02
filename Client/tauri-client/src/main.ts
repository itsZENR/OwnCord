// OwnCord Tauri v2 Client — Entry Point

import "@styles/tokens.css";
import "@styles/base.css";
import "@styles/login.css";
import "@styles/app.css";
import "@styles/theme-neon-glow.css";
import "@styles/community.css";

import { installGlobalErrorHandlers, safeMount } from "@lib/safe-render";
import { createRouter } from "@lib/router";
import { createApiClient } from "@lib/api";
import { createWsClient } from "@lib/ws";
import { wireDispatcher } from "@lib/dispatcher";
import { authStore, clearAuth } from "@stores/auth.store";
import { setTransientError } from "@stores/ui.store";
import { voiceStore, leaveVoiceChannel } from "@stores/voice.store";
import { leaveVoice as voiceSessionLeave } from "@lib/livekitSession";
import { createConnectPage } from "@pages/ConnectPage";
import { createMainPage } from "@pages/MainPage";
import { applyStoredAppearance } from "@components/SettingsOverlay";
import { restoreTheme } from "@lib/themes";
import { initPtt } from "@lib/ptt";
import { createConnectedOverlay } from "@components/ConnectedOverlay";
import type { ConnectedOverlayControl } from "@components/ConnectedOverlay";
import { createLogger } from "@lib/logger";
import { initLogPersistence, flushLogs } from "@lib/logPersistence";
import { saveCredential, loadCredential, deleteCredential } from "@lib/credentials";
import { initWindowState } from "@lib/window-state";
import { createCertMismatchModal } from "@components/CertMismatchModal";
import { createProfileManager, createPlatformBackend } from "@lib/profiles";
import type { CertTofuEvent } from "@lib/ws";

import { isTauri } from "@lib/platform";
import { describeError, t } from "@lib/i18n";
import { normalizeServerAddress } from "@lib/serverAddress";

const log = createLogger("main");

// Disable the default browser context menu globally.
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// F12 or Ctrl+Shift+I opens WebView2 DevTools.
document.addEventListener("keydown", (e) => {
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
    if (!isTauri()) return; // browser has its own devtools
    e.preventDefault();
    void import("@tauri-apps/api/core").then(({ invoke }) => {
      void invoke("open_devtools");
    });
  }
});

// Open external links (target="_blank") in the user's default browser.
document.addEventListener("click", (e) => {
  const link = (e.target as HTMLElement).closest("a[target='_blank']");
  if (link === null) return;
  e.preventDefault();
  const href = (link as HTMLAnchorElement).href;
  if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
    if (isTauri()) {
      void import("@tauri-apps/plugin-opener").then(({ openUrl }) => { void openUrl(href); });
    } else {
      window.open(href, "_blank", "noopener");
    }
  }
});

// Install global error handlers first
installGlobalErrorHandlers();

// Apply stored theme/font/compact preferences before first render
applyStoredAppearance();

// Restore saved theme (body class) before first render
restoreTheme();

// Start push-to-talk listener (Rust-side polling, non-consuming)
void initPtt();

const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("Missing #app element");
}

// Create core services
const router = createRouter("connect");
const api = createApiClient({ host: "" }, () => {
  log.warn("Session expired (401), clearing auth");
  clearAuth();
});
const ws = createWsClient();
const profileManager = createProfileManager(createPlatformBackend());
let dispatcherCleanup: (() => void) | null = null;
let connectedOverlay: ConnectedOverlayControl | null = null;
let lastConnectHost = "";
let lastConnectToken = "";
let skipAutoLoginOnce = false;
let connectionAttemptCleanup: (() => void) | null = null;

// Certificate mismatch modal handler
let certModalActive = false;
ws.onCertMismatch((evt: CertTofuEvent) => {
  if (certModalActive) return;
  certModalActive = true;

  const modal = createCertMismatchModal({
    host: evt.host,
    storedFingerprint: evt.storedFingerprint ?? "Unknown",
    newFingerprint: evt.fingerprint,
    onAccept: () => {
      modal.destroy?.();
      certModalActive = false;
      void (async () => {
        try {
          await ws.acceptCertFingerprint(evt.host, evt.fingerprint);
          if (lastConnectHost && lastConnectToken) {
            ws.connect({ host: lastConnectHost, token: lastConnectToken });
          }
        } catch (err) {
          log.error("Failed to accept cert fingerprint", err);
        }
      })();
    },
    onReject: () => {
      modal.destroy?.();
      certModalActive = false;
      ws.disconnect();
      clearAuth();
      router.navigate("connect");
    },
  });
  modal.mount(document.body);
});

// Current page component reference for cleanup
let currentPage: { destroy?(): void } | null = null;

/** Run health checks for a list of profiles and update the connect page. */
function runHealthChecks(
  connectPage: { updateHealthStatus(host: string, status: { status: string; latencyMs: number | null; version: string | null; onlineUsers: number | null }): void },
  profiles: readonly { host: string }[],
): void {
  for (const profile of profiles) {
    void (async () => {
      try {
        connectPage.updateHealthStatus(profile.host, {
          status: "checking",
          latencyMs: null,
          version: null,
          onlineUsers: null,
        });
        const start = performance.now();
        const health = await api.getHealth(profile.host, 3000);
        const elapsed = Math.round(performance.now() - start);
        connectPage.updateHealthStatus(profile.host, {
          status: elapsed > 1500 ? "slow" : "online",
          latencyMs: elapsed,
          version: health.version,
          onlineUsers: health.online_users ?? null,
        });
      } catch {
        connectPage.updateHealthStatus(profile.host, {
          status: "offline",
          latencyMs: null,
          version: null,
          onlineUsers: null,
        });
      }
    })();
  }
}

// Render the appropriate page based on router state
function renderPage(pageId: "connect" | "main"): void {
  log.info("Navigating to page", { pageId });
  connectionAttemptCleanup?.();
  connectionAttemptCleanup = null;
  // Destroy previous page
  currentPage?.destroy?.();
  currentPage = null;
  appEl!.textContent = "";

  // Shared helper for post-auth WS connect + overlay flow
  function wirePostAuth(host: string, token: string, username: string, password?: string, persist = true): void {
    connectionAttemptCleanup?.();
    log.info("Post-auth wiring", { host, username });
    api.setConfig({ token });
    // Store token in authStore so the dispatcher's auth_ok handler has it
    authStore.setState((prev) => ({ ...prev, token }));
    lastConnectHost = host;
    lastConnectToken = token;
    dispatcherCleanup?.();
    dispatcherCleanup = wireDispatcher(ws);
    log.info("Dispatcher wired, connecting WS");

    // Save credential for auto-reconnect. Warn user if it fails.
    saveCredential(host, username, token, password, persist).then((ok) => {
      if (!ok) {
        log.warn("Credential save failed — auto-login will not work for this server");
        setTransientError("Could not save credentials — auto-login won't work");
      }
    }).catch(() => {
      // saveCredential already catches internally; this is defence-in-depth
    });

    const attemptUnsubs: Array<() => void> = [];
    let elapsed = 0;
    const connectionTimer = setInterval(() => {
      if (certModalActive) return;
      elapsed++;
      if (elapsed >= 20) failConnection(t("Connection timed out. Check your server address and network, then try again.", "Сервер не завершил подключение. Проверьте адрес, интернет или VPN и повторите вход."));
    }, 1000);
    connectionAttemptCleanup = () => {
      clearInterval(connectionTimer);
      for (const unsub of attemptUnsubs) unsub();
    };
    function failConnection(message: string): void {
      connectionAttemptCleanup?.();
      connectionAttemptCleanup = null;
      dispatcherCleanup?.();
      dispatcherCleanup = null;
      ws.disconnect();
      connectedOverlay?.destroy();
      connectedOverlay = null;
      clearAuth();
      setTransientError(message);
    }
    attemptUnsubs.push(ws.on("auth_error", (payload) => failConnection(describeError(payload.message))));
    const unsubState = ws.onStateChange((wsState) => {
      log.debug("WS state change", { state: wsState });
      if (wsState === "connected") {
        unsubState();
        const auth = authStore.getState();
        connectedOverlay = createConnectedOverlay({
          serverName: auth.serverName ?? host,
          username: auth.user?.username ?? username,
          motd: auth.motd ?? "",
          onReady: () => {
            connectedOverlay?.destroy();
            connectedOverlay = null;
            router.navigate("main");
          },
        });
        appEl!.appendChild(connectedOverlay.element);
        connectedOverlay.show();

        const unsubReady = ws.on("ready", () => {
          unsubReady();
          connectedOverlay?.markReady();
        });
        attemptUnsubs.push(unsubReady);
      }
    });
    attemptUnsubs.push(unsubState);
    ws.connect({ host, token });
  }

  // Track partial auth state for TOTP flow
  let pendingTotpHost = "";
  let pendingTotpPartialToken = "";
  let pendingTotpUsername = "";
  let pendingTotpPassword: string | undefined;
  let pendingTotpRemember = false;

  if (pageId === "connect") {
    // Helper to get the profile list for the ConnectPage
    function getProfileList(): readonly { name: string; host: string; id?: string; username?: string }[] {
      const saved = profileManager.getAll();
      if (saved.length > 0) return saved;
      // Fallback: show a default local server entry
      return [{ name: "Local Server", host: "localhost:8443" }];
    }

    // Auto-save a profile for a host after successful login (if not already saved)
    function ensureProfileExists(host: string, username: string, rememberPassword: boolean): void {
      const existing = profileManager.getAll().find((p) => p.host === host);
      if (existing) {
        // Remembering a sign-in also opts this server into token-based auto-login.
        // The browser never receives a reusable password from credential storage.
        profileManager.updateProfile(existing.id, { username, rememberPassword, autoConnect: false });
        if (rememberPassword) profileManager.setAutoLogin(existing.id);
        profileManager.setLastConnected(existing.id);
      } else {
        const created = profileManager.addProfile({
          name: host.split(":")[0] ?? host,
          host,
          username,
          autoConnect: false,
          rememberPassword,
          color: "#5865F2",
        });
        if (rememberPassword) profileManager.setAutoLogin(created.id);
        profileManager.setLastConnected(created.id);
      }
      void profileManager.saveProfiles();
    }

    const connectPage = createConnectPage({
      async onLogin(host, username, password) {
        host = normalizeServerAddress(host);
        api.setConfig({ host, token: undefined });
        const result = await api.login(username, password);
        if (result.requires_2fa) {
          pendingTotpHost = host;
          pendingTotpPartialToken = result.partial_token ?? "";
          pendingTotpUsername = username;
          pendingTotpPassword = connectPage.getRememberPassword() ? password : undefined;
          pendingTotpRemember = connectPage.getRememberPassword();
          connectPage.showTotp();
          return;
        }
        if (result.token) {
          const remember = connectPage.getRememberPassword();
          const savedPassword = remember ? password : undefined;
          ensureProfileExists(host, username, remember);
          wirePostAuth(host, result.token, username, savedPassword, remember);
        }
      },
      async onRegister(host, username, password, inviteCode) {
        host = normalizeServerAddress(host);
        api.setConfig({ host, token: undefined });
        const result = await api.register(username, password, inviteCode);
        const remember = connectPage.getRememberPassword();
        const savedPassword = remember ? password : undefined;
        ensureProfileExists(host, username, remember);
        wirePostAuth(host, result.token, username, savedPassword, remember);
      },
      async onTotpSubmit(code) {
        if (!pendingTotpPartialToken) {
          log.error("TOTP submit without pending partial token");
          return;
        }
        const result = await api.verifyTotp(code, pendingTotpPartialToken);
        if (result.token) {
          const remember = pendingTotpRemember;
          const savedPassword = pendingTotpPassword;
          ensureProfileExists(pendingTotpHost, pendingTotpUsername, remember);
          wirePostAuth(pendingTotpHost, result.token, pendingTotpUsername, savedPassword, remember);
          pendingTotpPassword = undefined;
          pendingTotpPartialToken = "";
        }
      },
      onAddProfile(name, host) {
        host = normalizeServerAddress(host);
        profileManager.addProfile({
          name,
          host,
          username: "",
          autoConnect: false,
          rememberPassword: false,
          color: "#5865F2",
        });
        void profileManager.saveProfiles();
        connectPage.refreshProfiles(getProfileList());
        // Check health for the new profile
        runHealthChecks(connectPage, getProfileList());
      },
      onDeleteProfile(profileId) {
        const profile = profileManager.getById(profileId);
        if (profile) void deleteCredential(profile.host);
        profileManager.removeProfile(profileId);
        void profileManager.saveProfiles();
        connectPage.refreshProfiles(getProfileList());
      },
      onToggleAutoLogin(profileId, enabled) {
        profileManager.setAutoLogin(enabled ? profileId : null);
        void profileManager.saveProfiles();
        connectPage.refreshProfiles(getProfileList());
      },
      onAutoLoginCancel() {
        autoLoginCancelled = true;
      },
    }, getProfileList());

    let autoLoginCancelled = false;

    safeMount(connectPage, appEl!);

    // Periodic health check — re-run every 15s so offline servers update when they come back
    const healthCheckInterval = setInterval(() => {
      runHealthChecks(connectPage, getProfileList());
    }, 15_000);

    // Wrap destroy to clear the interval
    currentPage = {
      destroy() {
        autoLoginCancelled = true;
        clearInterval(healthCheckInterval);
        connectPage.destroy?.();
      },
    };

    // Load saved profiles and kick off health checks
    void (async () => {
      try {
        await profileManager.loadProfiles();
        const profiles = getProfileList();
        connectPage.refreshProfiles(profiles);
        const last = [...profileManager.getAll()].sort((a, b) => (b.lastConnected ?? "").localeCompare(a.lastConnected ?? ""))[0];
        if (last && !autoLoginCancelled) connectPage.selectServer(last.host, last.username);
        runHealthChecks(connectPage, profiles);
      } catch (err) {
        log.warn("Failed to load profiles, using defaults", err);
        runHealthChecks(connectPage, getProfileList());
      }

      // Quick-switch: if the user switched servers via the overlay, auto-select
      // the target server profile so they can reconnect with one click.
      const quickSwitchTarget = sessionStorage.getItem("owncord:quick-switch-target");
      if (quickSwitchTarget !== null) {
        sessionStorage.removeItem("owncord:quick-switch-target");
        const targetProfile = profileManager.getAll().find((p) => p.host === quickSwitchTarget);
        connectPage.selectServer(
          quickSwitchTarget,
          targetProfile?.username ?? undefined,
        );
        return; // Skip auto-login when switching servers
      }

      // Auto-login: if a profile has autoConnect enabled, try to connect automatically.
      const skip = skipAutoLoginOnce;
      skipAutoLoginOnce = false;
      const autoProfile = skip ? null : profileManager.getAutoConnectProfile();
      if (autoProfile) {
        try {
          const cred = await loadCredential(autoProfile.host);
          if (cred?.username && !autoLoginCancelled) {
            connectPage.selectServer(autoProfile.host, cred.username);
            connectPage.showAutoConnecting(autoProfile.name);
            // A saved session works in both the browser and the desktop client.
            if (cred.token) {
              const savedApi = createApiClient({ host: autoProfile.host, token: cred.token });
              try {
                await savedApi.getMe();
                if (autoLoginCancelled) return;
                api.setConfig({ host: autoProfile.host });
                wirePostAuth(autoProfile.host, cred.token, cred.username, cred.password);
                return;
              } catch (err) {
                if (!(err && typeof err === "object" && "status" in err && err.status === 401)) throw err;
                if (!cred.password) throw new Error(t("Your saved session expired. Please sign in again.", "Сохранённый сеанс истёк. Введите пароль для повторного входа."));
              }
            }
          }
          if (cred?.username && cred?.password && !autoLoginCancelled) {
            connectPage.selectServer(autoProfile.host, cred.username);
            connectPage.showAutoConnecting(autoProfile.name);

            // Attempt login
            api.setConfig({ host: autoProfile.host });
            const result = await api.login(cred.username, cred.password);

            if (autoLoginCancelled) return;

            if (result.requires_2fa) {
              // Can't auto-login with 2FA — show TOTP overlay
              pendingTotpHost = autoProfile.host;
              pendingTotpPartialToken = result.partial_token ?? "";
              pendingTotpUsername = cred.username;
              pendingTotpPassword = cred.password;
              pendingTotpRemember = true;
              connectPage.showTotp();
              return;
            }

            if (result.token) {
              ensureProfileExists(autoProfile.host, cred.username, true);
              wirePostAuth(autoProfile.host, result.token, cred.username, cred.password);
              return;
            }
          }
        } catch (err) {
          if (!autoLoginCancelled) {
            const message = err instanceof Error ? err.message : "Auto-login failed";
            log.warn("Auto-login failed", { host: autoProfile.host, error: message });
            connectPage.showError(describeError(message));
          }
        }
      }
    })();
  } else {
    const mainPage = createMainPage({
      ws,
      api,
      onProfileRenamed: async (oldUsername, newUsername) => {
        const host = api.getConfig().host;
        for (const profile of profileManager.getAll()) {
          if (profile.host === host && profile.username.toLowerCase() === oldUsername.toLowerCase()) {
            profileManager.updateProfile(profile.id, { username: newUsername });
          }
        }
        await profileManager.saveProfiles();
      },
    });
    safeMount(mainPage, appEl!);
    currentPage = mainPage;
  }
}

// Listen for navigation changes
router.onNavigate(renderPage);

// Handle logout / disconnect
authStore.subscribeSelector(
  (s) => s.isAuthenticated,
  (isAuthenticated) => {
    if (!isAuthenticated && router.getCurrentPage() === "main") {
      // Leave voice channel before disconnecting so other clients see it immediately
      const voice = voiceStore.getState();
      if (voice.currentChannelId !== null) {
        voiceSessionLeave(false); // false: we send voice_leave below
        ws.send({ type: "voice_leave", payload: {} });
        leaveVoiceChannel();
      }
      dispatcherCleanup?.();
      dispatcherCleanup = null;
      ws.disconnect();
      lastConnectToken = "";
      lastConnectHost = "";
      // Disconnects, expired sessions and server switches must not erase passwords.
      // Explicit account logout removes credentials in MainPage.
      skipAutoLoginOnce = true;
      api.setConfig({ token: undefined });
      router.navigate("connect");
    }
  },
);

// Send voice_leave on window close (best-effort — server readPump defer is the safety net)
window.addEventListener("beforeunload", () => {
  const voice = voiceStore.getState();
  if (voice.currentChannelId !== null) {
    voiceSessionLeave(false); // false: we send voice_leave below
    ws.send({ type: "voice_leave", payload: {} });
  }
  // Flush any buffered log entries to disk before the window closes.
  void flushLogs();
});

// Initial render
renderPage(router.getCurrentPage());

// Initialize window state persistence (fire-and-forget)
void initWindowState();

// Initialize log persistence to disk (fire-and-forget)
void initLogPersistence();

log.info("OwnCord client initialized");
