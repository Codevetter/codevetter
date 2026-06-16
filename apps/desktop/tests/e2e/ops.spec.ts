import { expect, test } from "@playwright/test";

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from "./helpers";

test.describe("Ops page", () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test("/ops renders the three operational panels", async ({ page }) => {
    await navigateTo(page, "/ops");
    await waitForNoSpinners(page);

    await expect(page.locator("h1", { hasText: "Ops" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Provider billing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Agent observability/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
  });
});
