import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "../integration/notifications-e2e-data";

for (const theme of ["light", "dark"] as const) {
  test(`English: уведомления, дайджест и чтение · ${theme}`, async ({
    page,
    context,
    baseURL,
    loginAs,
    notificationsData,
    notificationTitle,
  }, info) => {
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    await notificationsData.insert({
      title: notificationTitle,
      priority: "low",
    });
    await page.setViewportSize(
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 },
    );
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAs("anna");
    await context.addCookies([
      { name: "pulse-language", value: "en", url: baseURL },
    ]);
    await page.goto("/notifications");
    const main = page.getByRole("main");
    await expect(main.locator("[data-notifications-ready]")).toHaveAttribute(
      "data-notifications-ready",
      "true",
    );
    await expect(
      main.getByRole("heading", { name: "Notifications", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Notifications/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const bell = page.locator("header [data-unread-count]");
    const before = Number(await bell.getAttribute("data-unread-count"));
    await expect(
      page.locator("header a[href='/notifications']"),
    ).toHaveAccessibleName(`Notifications: ${before} unread`);
    const changed = main.locator("li[data-notification-id]").filter({
      has: page.getByRole("heading", {
        name: "Пара перенесена",
        exact: true,
      }),
    });
    await expect(
      changed.getByText("Notification content is available in Russian.", {
        exact: true,
      }),
    ).toBeVisible();
    await changed
      .getByRole("link", { name: "Open schedule", exact: true })
      .click();
    await expect(page).toHaveURL(/\/schedule$/);
    await expect(bell).toHaveAttribute("data-unread-count", String(before - 1));
    await page.goto("/notifications");
    await expect(main.locator("[data-notifications-ready]")).toHaveAttribute(
      "data-notifications-ready",
      "true",
    );
    const digest = main.getByRole("button", { name: /^Digest/ });
    await expect(digest).toHaveAttribute("aria-expanded", "false");
    await expect(
      main.getByRole("heading", { name: notificationTitle, exact: true }),
    ).toBeHidden();
    await digest.click();
    await expect(digest).toHaveAttribute("aria-expanded", "true");
    await expect(
      main.getByRole("heading", { name: notificationTitle, exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole("region", { name: "Quiet mode" }),
    ).toContainText("Nothing urgent: read these when it suits you.");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await main
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.every(
            (button) =>
              getComputedStyle(button).wordBreak !== "break-all" &&
              getComputedStyle(button).overflowWrap !== "anywhere",
          ),
        ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`notifications-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await main
      .getByRole("button", { name: "Student office news", exact: true })
      .click();
    await expect(
      main.getByRole("heading", { name: "Пара перенесена", exact: true }),
    ).toHaveCount(0);
    await main.getByRole("button", { name: "All", exact: true }).click();
    await main
      .getByRole("button", { name: "Mark all as read", exact: true })
      .click();
    await expect(bell).toHaveAttribute("data-unread-count", "0");
    await expect(
      main.getByRole("button", { name: "Mark all as read", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator("header a[href='/notifications']"),
    ).toHaveAccessibleName("Notifications: 0 unread");
  });
}
