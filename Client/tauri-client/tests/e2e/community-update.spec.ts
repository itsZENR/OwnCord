import { test, expect } from "@playwright/test";
import { buildTauriMockScript, MOCK_AUTH_OK, MOCK_LOGIN_RESPONSE, MOCK_MESSAGES, MOCK_READY_PAYLOAD, navigateToMainPage, emitWsMessage } from "./helpers";

test("Russian session timers, cumulative statistics, call controls and actionable errors", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("owncord:language", "ru"));
  await page.addInitScript(buildTauriMockScript({
    httpRoutes: [
      { pattern: "/health", status: 200, body: { status: "ok", version: "1.1.3" } },
      { pattern: "/auth/login", status: 200, body: MOCK_LOGIN_RESPONSE },
      { pattern: "/activity", status: 200, body: { members: [
        { user_id: 1, total_seconds: 39600, sessions: 12, channel_seconds: { "10": 39600 } },
        { user_id: 2, total_seconds: 192600, sessions: 30, channel_seconds: { "10": 192600 } },
      ] } },
      { pattern: "/messages", status: 200, body: MOCK_MESSAGES },
    ],
    simulateWsFlow: true,
    readyOverrides: {
      channels: [...MOCK_READY_PAYLOAD.payload.channels, { id: 10, name: "Игровая", type: "voice", position: 2, category: null }],
      voice_states: [
        { user_id: 1, channel_id: 10, muted: false, deafened: false, joined_at: 1700000000 - 7200, channel_started_at: 1700000000 - 7200, server_time: 1700000000 },
        { user_id: 2, channel_id: 10, muted: false, deafened: false, joined_at: 1700000000 - 60, channel_started_at: 1700000000 - 7200, server_time: 1700000000 },
      ],
      dm_channels: [{ channel_id: 100, recipient: { id: 2, username: "otheruser", avatar: "", status: "online" }, last_message_id: 0, unread_count: 0 }],
    },
    wsHandlers: [{ type: "call_end", handler: `setTimeout(function() { __tauriEmitEvent("ws-message", JSON.stringify({type: "call_state", payload: {id: parsed.payload.id, channel_id: 100, caller_id: 2, recipient_id: 1, caller_name: "otheruser", recipient_name: "testuser", state: "ended", reason: "declined", expires_at: 0}})); }, 10);` }],
  }));
  await page.goto("/");
  await expect(page.locator("label[for=password]")).toHaveText("Пароль");
  await page.screenshot({ path: testInfo.outputPath("login-ru.png") });
  await navigateToMainPage(page);
  const myTimer = page.locator('[data-voice-uid="1"] .vu-session-time');
  const friendTimer = page.locator('[data-voice-uid="2"] .vu-session-time');
  const sharedTimer = page.locator('[data-testid="channel-10"] .vc-session-time');
  await expect(myTimer).toHaveText(/^02:00:\d{2}$/);
  await expect(friendTimer).toHaveText(/^00:01:\d{2}$/);
  await expect(sharedTimer).toHaveText(/^02:00:\d{2}$/);
  const before = await friendTimer.textContent();
  await expect(friendTimer).not.toHaveText(before!);
  await page.screenshot({ path: testInfo.outputPath("voice-sessions-ru.png"), fullPage: true });
  await emitWsMessage(page, { type: "voice_leave", payload: { user_id: 1, channel_id: 10 } });
  await expect(myTimer).toHaveCount(0);
  await expect(sharedTimer).toHaveText(/^02:00:\d{2}$/);
  await page.getByTestId("achievements-tab").click();
  await expect(page.getByTestId("achievements-page")).toBeVisible();
  await expect(page.locator(".achievement-card")).toHaveCount(0);
  await expect(page.locator(".statistics-metrics")).toContainText("11 ч 0 мин");
  await expect(page.locator(".activity-board-row")).toHaveCount(2);
  const friendStats = page.locator(".activity-board-row").filter({ hasText: "otheruser" });
  await friendStats.locator("summary").click();
  await expect(friendStats.locator("dt")).toHaveText("Игровая");
  await expect(friendStats.locator("dd")).toHaveText("53 ч 30 мин");
  await expect(page.locator(".voice-regalia").first()).toHaveAttribute("title", /Голосовое время на сервере/);
  await expect(page.getByTestId("chat-area")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("statistics-ru.png"), fullPage: true });
  await page.locator(".workspace-tab").first().click();
  await page.getByTestId("dm-entry").click();
  await expect(page.getByTestId("call-start")).toBeVisible();
  await emitWsMessage(page, { type: "call_state", payload: {
    id: "call-test", channel_id: 100, caller_id: 2, recipient_id: 1, caller_name: "otheruser", recipient_name: "testuser", state: "ringing", expires_at: Math.floor(Date.now() / 1000) + 30,
  } });
  await expect(page.getByTestId("call-accept")).toBeVisible();
  await expect(page.locator(".direct-call")).toContainText("Входящий звонок");
  await page.screenshot({ path: testInfo.outputPath("incoming-call-ru.png") });
  await page.getByTestId("call-end").click();
  await expect(page.locator(".direct-call")).toBeHidden();
  await emitWsMessage(page, { type: "error", payload: { code: "VOICE_ERROR", message: "voice is not configured on this server" } });
  await expect(page.getByTestId("toast").last()).toContainText("настроить LiveKit");
  expect(pageErrors).toEqual([]);
});

test("browser restores a saved session without a saved password and survives reload", async ({ page }) => {
  let loginRequests = 0;
  await page.addInitScript(() => {
    if (localStorage.getItem("owncord:settings")) return;
    localStorage.setItem("owncord:language", "en");
    localStorage.setItem("owncord:cred:chat.test", JSON.stringify({ username: "testuser", token: "saved-token" }));
    localStorage.setItem("owncord:settings", JSON.stringify({ "owncord:profiles": {
      schemaVersion: 1, profiles: [{ id: "saved", name: "Squad", host: "chat.test", username: "testuser", autoConnect: true, rememberPassword: true, color: "#00c8ff", lastConnected: null }],
    } }));
  });
  await page.route("https://chat.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/login")) loginRequests++;
    const body = path.endsWith("/users/me") ? MOCK_AUTH_OK.payload.user
      : path.endsWith("/activity") ? { members: [] }
      : path.endsWith("/messages") ? { messages: [], has_more: false }
      : { status: "ok", version: "1.1.3", online_users: 2 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.routeWebSocket("wss://chat.test/api/v1/ws", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "auth") {
        socket.send(JSON.stringify(MOCK_AUTH_OK));
        socket.send(JSON.stringify(MOCK_READY_PAYLOAD));
      }
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("app-layout")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("app-layout")).toBeVisible({ timeout: 15_000 });
  expect(loginRequests).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("owncord:cred:chat.test")!).token)).toBe("saved-token");
});

test("remembering a fresh browser login enables automatic sign-in after reload", async ({ page }) => {
  let loginRequests = 0;
  await page.addInitScript(() => localStorage.setItem("owncord:language", "en"));
  await page.route("https://chat.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/login")) loginRequests++;
    const body = path.endsWith("/auth/login") ? MOCK_LOGIN_RESPONSE
      : path.endsWith("/users/me") ? MOCK_AUTH_OK.payload.user
      : path.endsWith("/activity") ? { members: [] }
      : path.endsWith("/messages") ? { messages: [], has_more: false }
      : { status: "ok", version: "1.2.0", online_users: 2 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.routeWebSocket("wss://chat.test/api/v1/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "auth") {
        socket.send(JSON.stringify(MOCK_AUTH_OK));
        socket.send(JSON.stringify(MOCK_READY_PAYLOAD));
      }
    });
  });
  await page.goto("/");
  await page.locator("#host").fill("chat.test");
  await page.locator("#username").fill("testuser");
  await page.locator("#password").fill("password123");
  await page.locator("#remember-password").check();
  await page.locator("button[type=submit]").click();
  await expect(page.getByTestId("app-layout")).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("owncord:cred:chat.test")!))).toEqual({
    username: "testuser", token: MOCK_LOGIN_RESPONSE.token,
  });
  await page.reload();
  await expect(page.getByTestId("app-layout")).toBeVisible({ timeout: 15_000 });
  expect(loginRequests).toBe(1);
});
