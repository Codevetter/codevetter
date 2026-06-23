import { defineConfig } from '@playwright/test';

/**
 * Playwright config for e2e tests.
 *
 * NOTE: tauri-driver uses the W3C WebDriver protocol, not Playwright's native
 * CDP protocol. On macOS, Tauri's WKWebView does not expose a CDP endpoint.
 *
 * The actual e2e tests in tests/e2e/ use Node's built-in test runner with
 * raw WebDriver fetch calls against tauri-driver (port 4444).
 *
 * This config exists as a placeholder for:
 * 1. Future Linux CI where WebKitGTK may support CDP
 * 2. Any Playwright-based assertions you want to run against the Vite dev server
 *    as a complement to the native app tests
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4444',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'tauri-webdriver',
      testMatch: /.*\.pw\.spec\.ts/,
    },
  ],
});
