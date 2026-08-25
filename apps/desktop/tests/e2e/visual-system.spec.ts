import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { ConsoleErrorCollector, navigateTo } from './helpers';

const routes = [
  ['Usage', '/'],
  ['Repo Unpack', '/unpack'],
  ['Review', '/review'],
  ['Testing', '/trex'],
  ['Performance', '/performance'],
  ['Settings', '/settings'],
] as const;

test.describe('desktop visual system', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
    await page.setViewportSize({ width: 1024, height: 720 });
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test('keeps every primary route bounded with one accessible active destination', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1024, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await navigateTo(page, '/');

      for (const [label, path] of routes) {
        const nav = page.getByRole('navigation', { name: 'Primary navigation' });
        await nav.getByRole('link', { name: label, exact: true }).click();
        await expect.poll(() => new URL(page.url()).pathname).toBe(path);

        await expect(nav).toBeVisible();
        await expect(nav.locator('[data-nav-destination]')).toHaveCount(routes.length);
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
          'aria-current',
          'page'
        );
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

        const layout = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

        const bounds = await nav.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }
    }
  });

  test('keeps navigation focus visible and suppresses non-essential reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigateTo(page, '/');

    await page.getByRole('link', { name: 'Performance' }).click();
    await expect(page).toHaveURL(/\/performance$/);
    await expect(page.getByRole('link', { name: 'Performance' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    await page.getByRole('link', { name: 'Testing' }).click();
    await expect(page).toHaveURL(/\/trex$/);

    const activeLink = page.getByRole('link', { name: 'Testing' });
    await expect(activeLink).toHaveAttribute('aria-current', 'page');
    await activeLink.focus();
    await expect(activeLink).toBeFocused();
    const transitionDurationMs = await activeLink.evaluate((element) => {
      const value = getComputedStyle(element).transitionDuration;
      return Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    });
    expect(transitionDurationMs).toBeLessThanOrEqual(0.001);
  });

  test('opens command search from the top bar and restores focus on close', async ({ page }) => {
    await navigateTo(page, '/');

    const search = page.getByRole('button', { name: 'Search commands' });
    const usage = page.getByRole('link', { name: 'Usage' });
    await expect(search).toBeVisible();
    await expect
      .poll(async () => Math.round((await search.boundingBox())?.height ?? 0))
      .toBeGreaterThanOrEqual(32);
    await expect
      .poll(async () => Math.round((await usage.boundingBox())?.height ?? 0))
      .toBeGreaterThanOrEqual(40);

    await search.focus();
    await search.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByPlaceholder('Search commands...')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(search).toBeFocused();
  });

  test('makes verification and performance easy to find', async ({ page }) => {
    await navigateTo(page, '/');

    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    const review = nav.getByRole('link', { name: 'Review', exact: true });
    await expect(review).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Testing', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Performance', exact: true })).toBeVisible();
    await expect(nav).not.toContainText('G H');
    await expect(nav).not.toContainText('G F');
    await review.click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole('heading', { name: 'Review the change' })).toBeVisible();

    await page.getByRole('button', { name: 'Search commands' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Check a change', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Go to Performance', { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText('g f');
  });

  test('retires embedded work routes without losing local product state', async ({ page }) => {
    for (const retired of ['/agents', '/agents/session-1', '/board', '/board/item-1']) {
      await navigateTo(page, retired);
      await expect.poll(() => new URL(page.url()).pathname).toBe('/');
      await expect(page.getByRole('link', { name: 'Usage' })).toHaveAttribute(
        'aria-current',
        'page'
      );
    }
  });

  test('resolves and explicitly confirms a shared performance scope plan', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateTo(page, '/performance?__codevetter_preview=performance-empty');

    const planner = page.getByRole('region', { name: 'Performance scope planner' });
    await expect(planner.getByRole('button', { name: /Function or flow/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(planner.getByRole('button', { name: /PR or change/ })).toBeVisible();
    await expect(planner.getByRole('button', { name: /Entire codebase/ })).toBeVisible();
    await expect(planner.getByText(/Illustrative preview/)).toBeVisible();
    await expect(planner.getByText(/Uncovered \(1\)/)).toBeVisible();
    for (const control of [
      planner.getByLabel('Function or flow description'),
      planner.getByRole('button', { name: 'Resolve scope' }),
      planner.getByRole('button', { name: 'Confirm 1 scope' }),
    ]) {
      await expect
        .poll(async () => (await control.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
    }

    await planner.getByRole('button', { name: /src\/cart\/cart\.test\.ts/ }).click();
    await planner.getByRole('button', { name: 'Confirm 1 scope' }).click();
    await expect(planner.getByRole('button', { name: 'Plan confirmed' })).toBeDisabled();
    await expect(page.getByLabel('Relative target')).toHaveValue('src/cart/cart.test.ts');

    await page.getByLabel('Relative target').fill('src/cart/other.test.ts');
    await expect(planner.getByRole('button', { name: 'Confirm 1 scope' })).toBeEnabled();
  });

  test('has no serious accessibility violations on primary routes', async ({ page }) => {
    test.setTimeout(60_000);
    for (const [label, path] of routes) {
      await navigateTo(page, path);
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect(page.locator('h1').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      );
      expect(blocking, `${path} serious accessibility violations`).toEqual([]);
    }
  });
});

test('renders a local-only recovery surface for a captured shell failure', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __CODEVETTER_VERIFY__: {
        protocolVersion: 1,
        runId: 'crash-recovery-run',
        scenarioId: 'shell-crash-recovery',
        stateName: 'shell-crash-recovery',
        frozenTime: '2026-08-16T02:00:00.000Z',
        flags: {},
      },
    });
  });
  await page.goto('/?private=not-recorded');

  const recovery = page.getByTestId('crash-recovery');
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('heading')).toHaveText('CodeVetter stopped rendering');
  await expect(recovery.getByRole('heading')).toBeFocused();
  await expect(recovery.getByText('Local-only incident receipt')).toBeVisible();
  await expect(recovery.getByText('Repository state was not checked.')).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Try CodeVetter again' })).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Reload CodeVetter' })).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Return to Usage' })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(recovery.getByRole('button', { name: 'Try CodeVetter again' })).toBeFocused();

  const accessibility = await new AxeBuilder({ page }).analyze();
  const blocking = accessibility.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious'
  );
  expect(blocking).toEqual([]);

  const receipt = await page.evaluate(() => sessionStorage.getItem('codevetter:last-ui-incident'));
  expect(receipt).not.toContain('Synthetic verification crash');
  expect(receipt).not.toContain('private=not-recorded');
});
