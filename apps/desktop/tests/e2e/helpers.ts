import { type Page, expect } from '@playwright/test';

/**
 * Console error collector. Attach in beforeEach, assert in afterEach.
 * Filters out known noise (Tauri IPC failures, React dev warnings).
 */
export class ConsoleErrorCollector {
  errors: string[] = [];

  private static IGNORED_PATTERNS = [
    // Tauri IPC is unavailable in browser — expected
    'TAURI_NOT_AVAILABLE',
    '__TAURI__',
    'ipc://localhost',
    'tauri://localhost',
    // Vite HMR noise
    '[vite]',
    // React strict mode double-render warnings
    'findDOMNode is deprecated',
    // Network errors from missing Tauri backend
    'Failed to fetch',
    'NetworkError',
    'net::ERR_',
    // ResizeObserver can fire during layout shifts in tests
    'ResizeObserver loop',
  ];

  attach(page: Page) {
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const isIgnored = ConsoleErrorCollector.IGNORED_PATTERNS.some((p) => text.includes(p));
      if (!isIgnored) {
        this.errors.push(text);
      }
    });
  }

  assertNoErrors() {
    expect(this.errors, `Unexpected console errors:\n${this.errors.join('\n')}`).toHaveLength(0);
  }

  reset() {
    this.errors = [];
  }
}

/**
 * Navigate to a page and wait for the app shell to be ready.
 * The sidebar auto-hides after 2s, so we don't wait for it to be visible.
 */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  // Wait for the main content area to appear (Shell has rendered)
  await page.waitForSelector('main', { timeout: 10_000 });
}

/**
 * Wait until no loading spinners are visible on the page.
 * Looks for the animate-spin class used across the app.
 */
export async function waitForNoSpinners(page: Page, timeout = 5_000) {
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {
      // No spinner was present — that's fine
    });
}

/**
 * Show the floating nav bar by moving mouse to top of viewport.
 * The sidebar auto-hides after 2s; we need to hover near top to reveal it.
 */
export async function showNavBar(page: Page) {
  await page.mouse.move(640, 10);
  // Give the transition time to complete
  await page.waitForTimeout(400);
}
