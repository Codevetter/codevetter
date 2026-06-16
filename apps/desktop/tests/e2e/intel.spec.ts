import { expect, test } from "@playwright/test";

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from "./helpers";

test.describe("Intel page", () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test("/intel loads with both cards and a range picker", async ({ page }) => {
    await navigateTo(page, "/intel");
    await waitForNoSpinners(page);

    await expect(
      page.locator("h1", { hasText: "Engineering Intelligence" }),
    ).toBeVisible();
    await expect(page.getByText("Repo Attribution")).toBeVisible();
    await expect(page.getByText("Per-Tool LLM Usage")).toBeVisible();

    // The four compact range buttons should all be present.
    for (const label of ["7d", "30d", "90d", "All"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    // Run button is disabled until a path is entered.
    const runButton = page.getByRole("button", { name: "Run" });
    await expect(runButton).toBeDisabled();
  });

  test("typing a repo path enables Run", async ({ page }) => {
    await navigateTo(page, "/intel");
    await waitForNoSpinners(page);

    const input = page.getByPlaceholder("/Users/me/code/my-repo");
    await input.fill("/tmp/some-repo");

    await expect(page.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  test("range picker reflects selection", async ({ page }) => {
    await navigateTo(page, "/intel");
    await waitForNoSpinners(page);

    const all = page.getByRole("button", { name: "All", exact: true });
    await all.click();
    await expect(all).toBeVisible();
  });
});
