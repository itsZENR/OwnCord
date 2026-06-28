import { describe, it, expect, beforeEach, vi } from "vitest";
import { notifyIncomingMessage } from "../../src/lib/notifications";
import { authStore } from "../../src/stores/auth.store";
import { channelsStore } from "../../src/stores/channels.store";

// vi.hoisted ensures testPrefs is available when vi.mock factory runs
const { testPrefs } = vi.hoisted(() => ({
  testPrefs: new Map<string, unknown>(),
}));

// Mock the settings helpers
vi.mock("../../src/components/settings/helpers", () => ({
  STORAGE_PREFIX: "owncord:settings:",
  loadPref: (key: string, fallback: unknown) => testPrefs.get(key) ?? fallback,
  savePref: (key: string, value: unknown) => testPrefs.set(key, value),
  THEMES: { dark: {}, midnight: {}, light: {} },
  applyTheme: vi.fn(),
}));

// Mock livekitSession (imported transitively by auth.store)
vi.mock("../../src/lib/livekitSession", () => ({
  leaveVoice: vi.fn(),
  switchInputDevice: vi.fn(),
  switchOutputDevice: vi.fn(),
  setVoiceSensitivity: vi.fn(),
  setInputVolume: vi.fn(),
  setOutputVolume: vi.fn(),
  getSessionDebugInfo: vi.fn().mockReturnValue({}),
}));

// Mock platform — web build: isTauri() returns false
vi.mock("../../src/lib/platform/index", () => ({
  isTauri: vi.fn().mockReturnValue(false),
  getAppVersion: vi.fn().mockReturnValue("test"),
}));

// Minimal AudioContext stub so playNotificationSound doesn't throw
class MockAudioContext {
  readonly currentTime = 0;
  readonly destination = {};
  createOscillator() {
    return {
      connect: vi.fn(),
      frequency: { setValueAtTime: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    };
  }
}
(globalThis as Record<string, unknown>).AudioContext = MockAudioContext;

describe("notifications (web path)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    testPrefs.clear();

    // Set up auth store with a user whose id differs from the message sender
    authStore.setState(() => ({
      token: "test",
      user: { id: 1, username: "Me", avatar: null, role: "member" },
      serverName: null,
      motd: null,
      isAuthenticated: true,
    }));

    // Set up channels store
    channelsStore.setState(() => ({
      channels: new Map([
        [
          1,
          {
            id: 1,
            name: "general",
            type: "text" as const,
            category: null,
            position: 0,
            unreadCount: 0,
            lastMessageId: null,
          },
        ],
      ]),
      activeChannelId: 1,
      roles: [],
    }));

    // Simulate unfocused window so the focus gate is cleared
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  it("constructs a Web Notification when permission granted and window hidden", async () => {
    const ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "granted" }));

    notifyIncomingMessage({
      id: 42,
      channel_id: 1,
      user: { id: 2, username: "bob", avatar: null },
      content: "hi",
      reply_to: null,
      attachments: [],
      timestamp: new Date().toISOString(),
    });

    await vi.waitFor(() => {
      expect(ctor).toHaveBeenCalled();
    });
  });

  it("requests Web Notification permission when not yet granted and constructs on grant", async () => {
    const ctor = vi.fn();
    const mockRequestPerm = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal(
      "Notification",
      Object.assign(ctor, { permission: "default", requestPermission: mockRequestPerm }),
    );

    notifyIncomingMessage({
      id: 43,
      channel_id: 1,
      user: { id: 2, username: "bob", avatar: null },
      content: "hello",
      reply_to: null,
      attachments: [],
      timestamp: new Date().toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockRequestPerm).toHaveBeenCalled();
      expect(ctor).toHaveBeenCalled();
    });
  });

  it("does not construct a Web Notification when permission is denied", async () => {
    const ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "denied" }));

    notifyIncomingMessage({
      id: 44,
      channel_id: 1,
      user: { id: 2, username: "bob", avatar: null },
      content: "hi",
      reply_to: null,
      attachments: [],
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(ctor).not.toHaveBeenCalled();
  });

  it("does not fire when window is focused and message is in the active channel", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "granted" }));

    notifyIncomingMessage({
      id: 45,
      channel_id: 1,
      user: { id: 2, username: "bob", avatar: null },
      content: "hi",
      reply_to: null,
      attachments: [],
      timestamp: new Date().toISOString(),
    });

    // The gate: isWindowFocused() && channel_id === activeChannelId → early return
    expect(ctor).not.toHaveBeenCalled();
  });

  it("skips taskbar flash (no-op) on web without error", () => {
    // flashTaskbar early-returns on web; just confirm no throw
    const ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "granted" }));
    testPrefs.set("flashTaskbar", true);

    expect(() =>
      notifyIncomingMessage({
        id: 46,
        channel_id: 1,
        user: { id: 2, username: "bob", avatar: null },
        content: "hi",
        reply_to: null,
        attachments: [],
        timestamp: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
