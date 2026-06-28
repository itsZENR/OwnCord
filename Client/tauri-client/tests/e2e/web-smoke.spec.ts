import { test, expect } from "@playwright/test";

/**
 * Web smoke test — verifies the web bundle serves the connect page correctly
 * and that no Tauri-missing console errors surface.
 *
 * Selector rationale: `.connect-page` is the root element of ConnectPage
 * (confirmed in src/pages/ConnectPage.ts and tests/e2e/connect-page.spec.ts).
 * The app always boots to the connect route, so it is the first visible element.
 */
test("web client loads the connect page without Tauri errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");

  // Connect page root element must be visible — proves the app rendered.
  await expect(page.locator(".connect-page")).toBeVisible();

  // No console errors must contain "tauri" (case-insensitive).
  const tauriErrors = errors.filter((e) => /tauri/i.test(e));
  expect(tauriErrors, tauriErrors.join("\n")).toHaveLength(0);
});
