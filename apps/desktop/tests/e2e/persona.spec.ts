import { expect, test } from '@playwright/test';

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

test.describe('Personas page', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test('/personas renders configuration and accepts owner/repo', async ({ page }) => {
    await navigateTo(page, '/personas');
    await waitForNoSpinners(page);

    await expect(page.locator('h1', { hasText: 'Personas' })).toBeVisible();
    await expect(page.getByPlaceholder('sarthak-fleet/CodeVetter')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate' })).toBeVisible();
  });
});
