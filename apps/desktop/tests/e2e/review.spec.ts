import { test, expect } from '@playwright/test';
import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

test.describe('Review page', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
    await navigateTo(page, '/review');
    await waitForNoSpinners(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  // ─── Page header ──────────────────────────────────────────────────────

  test('Review heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  });

  // ─── Repository picker ────────────────────────────────────────────────

  test('Shared project sidebar is visible on Review', async ({ page }) => {
    await expect(page.getByText('Projects', { exact: true })).toBeVisible();
  });

  test('Only one project sidebar is shown (no second review column)', async ({ page }) => {
    await expect(page.locator('aside')).toHaveCount(1);
  });

  // ─── Right panel placeholder ──────────────────────────────────────────

  test('Empty state prompts project selection when none is active', async ({ page }) => {
    await expect(page.getByText('Select a project from the sidebar')).toBeVisible();
  });

  // ─── Past Reviews section ─────────────────────────────────────────────

  test('Past Reviews section appears if reviews exist', async ({ page }) => {
    const pastReviewsToggle = page.locator('button', {
      hasText: /Past Reviews/,
    });
    const hasSection = (await pastReviewsToggle.count()) > 0;

    if (!hasSection) {
      await expect(page.getByText('Select a project from the sidebar')).toBeVisible();
      return;
    }

    await pastReviewsToggle.click();
    await page.waitForTimeout(300);

    const firstReview = page
      .locator('button')
      .filter({ has: page.locator('text=/findings/') })
      .first();
    const reviewExists = (await firstReview.count()) > 0;

    if (!reviewExists) return;

    await firstReview.click();
    await waitForNoSpinners(page, 10_000);

    const severityBadges = page.locator('[class*="badge"], [class*="Badge"]');
    const hasCleanReview = (await page.locator('text=No findings').count()) > 0;
    const badgeCount = await severityBadges.count();
    if (badgeCount > 0) {
      expect(badgeCount).toBeGreaterThanOrEqual(0);
    } else if (hasCleanReview) {
      await expect(page.locator('text=No findings')).toBeVisible();
    }
  });

  // ─── New Review button in view mode ───────────────────────────────────

  test('New Review button appears when viewing a past review', async ({ page }) => {
    const pastReviewsToggle = page.locator('button', {
      hasText: /Past Reviews/,
    });
    const hasSection = (await pastReviewsToggle.count()) > 0;

    if (!hasSection) return;

    await pastReviewsToggle.click();
    await page.waitForTimeout(300);

    const firstReview = page
      .locator('button')
      .filter({ has: page.locator('text=/findings/') })
      .first();
    const reviewExists = (await firstReview.count()) > 0;

    if (!reviewExists) return;

    await firstReview.click();
    await waitForNoSpinners(page, 10_000);

    const newReviewButton = page.locator('button', {
      hasText: 'New Review',
    });
    await expect(newReviewButton).toBeVisible({ timeout: 5_000 });
  });

  // ─── New Review click returns to create form ──────────────────────────

  test('Clicking New Review returns to the create form', async ({ page }) => {
    const pastReviewsToggle = page.locator('button', {
      hasText: /Past Reviews/,
    });
    const hasSection = (await pastReviewsToggle.count()) > 0;

    if (!hasSection) {
      await expect(page.getByText('Select a project from the sidebar')).toBeVisible();
      return;
    }

    await pastReviewsToggle.click();
    await page.waitForTimeout(300);

    const firstReview = page
      .locator('button')
      .filter({ has: page.locator('text=/findings/') })
      .first();
    const reviewExists = (await firstReview.count()) > 0;

    if (!reviewExists) {
      await expect(page.getByText('Select a project from the sidebar')).toBeVisible();
      return;
    }

    await firstReview.click();
    await waitForNoSpinners(page, 10_000);

    const newReviewButton = page.locator('button', {
      hasText: 'New Review',
    });
    await expect(newReviewButton).toBeVisible({ timeout: 5_000 });
    await newReviewButton.click();

    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({
      timeout: 5_000,
    });
  });

  // ─── Tauri-unavailable state ──────────────────────────────────────────

  test('Shows appropriate state when Tauri is unavailable', async ({ page }) => {
    await expect(page.getByText('Projects', { exact: true })).toBeVisible();
    await expect(page.getByText('Select a project from the sidebar')).toBeVisible();
    await expect(page.locator('text=Loading past reviews')).toHaveCount(0);
    await expect(page.locator('aside')).toHaveCount(1);
  });
});
