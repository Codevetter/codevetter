import { test, expect } from '@playwright/test';
import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

test.describe('Settings page', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
    await navigateTo(page, '/settings');
    await waitForNoSpinners(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  // ─── General tab ──────────────────────────────────────────────────────

  test('General tab is selected by default and shows AI Provider section', async ({ page }) => {
    // "General" should be the active category
    await expect(page.locator('text=General').first()).toBeVisible();

    // AI Provider section heading
    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible();
  });

  // ─── Provider dropdown ────────────────────────────────────────────────

  test('Can select AI provider from dropdown', async ({ page }) => {
    // The provider dropdown is a <select> with the Provider label
    const providerSelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="anthropic"]') });
    await expect(providerSelect).toBeVisible();

    // Should default to "anthropic"
    await expect(providerSelect).toHaveValue('anthropic');

    // Change to OpenAI
    await providerSelect.selectOption('openai');
    await expect(providerSelect).toHaveValue('openai');

    // Change to OpenRouter
    await providerSelect.selectOption('openrouter');
    await expect(providerSelect).toHaveValue('openrouter');

    // Change to Custom
    await providerSelect.selectOption('custom');
    await expect(providerSelect).toHaveValue('custom');

    // Custom gateway shows Base URL field
    await expect(page.locator('text=Base URL')).toBeVisible();
  });

  // ─── API key input ────────────────────────────────────────────────────

  test('Can enter API key', async ({ page }) => {
    // API Key input
    const apiKeyInput = page.locator('input[placeholder="sk-..."]');
    await expect(apiKeyInput).toBeVisible();

    await apiKeyInput.fill('sk-test-key-12345');
    await expect(apiKeyInput).toHaveValue('sk-test-key-12345');
  });

  // ─── Save config button ───────────────────────────────────────────────

  test('Save AI Config button is present', async ({ page }) => {
    const saveButton = page.locator('button', { hasText: 'Save AI Config' });
    await expect(saveButton).toBeVisible();
  });

  test('Save AI Config button is disabled without required fields', async ({ page }) => {
    // Without an API key, the save button should be disabled
    // (disabled state depends on !aiApiKey || !aiBaseUrl || !aiModel)
    const saveButton = page.locator('button', { hasText: 'Save AI Config' });
    await expect(saveButton).toBeDisabled();
  });

  // ─── Category sidebar navigation ─────────────────────────────────────

  test('Settings sidebar shows all categories', async ({ page }) => {
    const expectedCategories = [
      'General',
      'Appearance',
      'Integrations',
      'Agents',
      'Notifications',
      'Usage',
      'About',
    ];

    for (const category of expectedCategories) {
      await expect(page.locator('button', { hasText: category }).first()).toBeVisible();
    }
  });

  test('Can switch between settings categories', async ({ page }) => {
    // Click Appearance
    await page.locator('button', { hasText: 'Appearance' }).first().click();
    await expect(page.locator('text=Compact Mode')).toBeVisible();

    // Click Agents
    await page.locator('button', { hasText: 'Agents' }).first().click();
    // Agents section should have agent-related settings
    await expect(page.locator('text=/Default Adapter|Max Concurrent/').first()).toBeVisible();

    // Click back to General
    await page.locator('button', { hasText: 'General' }).first().click();
    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible();
  });
});
