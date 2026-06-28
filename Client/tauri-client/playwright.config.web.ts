import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the web (browser-served) build.
 * Builds the web bundle via `build:web`, then serves it with `vite preview`
 * on port 4173 — the same URL the web smoke test hits.
 *
 * Usage:  npm run test:e2e:web
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["web-smoke.spec.ts"],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["junit", { outputFile: "test-results/web-junit.xml" }]]
    : "html",

  use: {
    baseURL: "http://localhost:4173",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command:
      "npm run build:web && npx vite preview --outDir dist-web --port 4173 --strictPort --host 0.0.0.0",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
