import { test, expect } from '@playwright/test';
import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

test.describe('Review page - Evidence', () => {
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

  test('can add and persist verification evidence to a finding', async ({ page }) => {
    const pastReviewsToggle = page.locator('button', {
      hasText: /Past Reviews/,
    });
    const hasSection = (await pastReviewsToggle.count()) > 0;

    if (!hasSection) {
      // No past reviews available — can't enter view mode to test evidence
      return;
    }

    // Expand and click a past review to enter view mode
    await pastReviewsToggle.click();
    await page.waitForTimeout(300);

    const firstReview = page
      .locator('button')
      .filter({ has: page.locator('text=/findings/') })
      .first();
    const reviewExists = (await firstReview.count()) > 0;

    if (!reviewExists) {
      // No reviews with findings to test
      return;
    }

    await firstReview.click();
    await waitForNoSpinners(page, 10_000);

    // Click on the first finding in the list
    const firstFinding = page.locator('[role=button]', { hasText: /severity/ }).first();
    const findingExists = (await firstFinding.count()) > 0;

    if (!findingExists) {
      // No findings in this review
      return;
    }

    await firstFinding.click();

    // Verify the evidence section is visible
    await expect(page.locator('text=Verification evidence')).toBeVisible();

    // Interact with the form
    const evidenceLevelSelect = page
      .locator('label', { hasText: 'Evidence level' })
      .locator('select');
    const recheckStatusSelect = page
      .locator('label', { hasText: 'Re-check status' })
      .locator('select');
    const artifactInput = page.locator('label', { hasText: 'Artifact' }).locator('input');
    const notesTextarea = page
      .locator('label', { hasText: 'QA steps / notes' })
      .locator('textarea');

    await evidenceLevelSelect.selectOption({ value: 'test' });
    await expect(evidenceLevelSelect).toHaveValue('test');

    await recheckStatusSelect.selectOption({ value: 'reproduced' });
    await expect(recheckStatusSelect).toHaveValue('reproduced');

    await artifactInput.fill('npm test:unit');
    await expect(artifactInput).toHaveValue('npm test:unit');

    await notesTextarea.fill('Ran the test, it failed as expected.');
    await expect(notesTextarea).toHaveValue('Ran the test, it failed as expected.');

    // Check for the "reproduced" badge on the finding
    await expect(firstFinding.locator('text=reproduced')).toBeVisible();

    // Check the evidence counts in the header
    await expect(page.locator('text=1 reproduced · 0 fixed')).toBeVisible();

    // "Reload" by clicking another review and coming back
    const secondReview = page
      .locator('button')
      .filter({ has: page.locator('text=/findings/') })
      .nth(1);

    const secondReviewExists = (await secondReview.count()) > 0;

    if (secondReviewExists) {
      await secondReview.click();
      await waitForNoSpinners(page, 10_000);

      await firstReview.click();
      await waitForNoSpinners(page, 10_000);

      await firstFinding.click();

      // Verify the form values have been persisted
      await expect(evidenceLevelSelect).toHaveValue('test');
      await expect(recheckStatusSelect).toHaveValue('reproduced');
      await expect(artifactInput).toHaveValue('npm test:unit');
      await expect(notesTextarea).toHaveValue('Ran the test, it failed as expected.');
    }
  });
});
