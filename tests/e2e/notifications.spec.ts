import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "../integration/notifications-e2e-data";

test.setTimeout(90_000);

test("Анна переходит к переносу, читает уведомления и управляет дайджестом", async ({
  page,
  loginAs,
  notificationsData,
  notificationTitle,
}) => {
  await notificationsData.insert({ title: notificationTitle, priority: "low" });
  await loginAs("anna");
  await page.goto("/notifications");
  const bell = page.locator("header [data-unread-count]");
  await expect(bell).toBeVisible();
  const before = Number(await bell.getAttribute("data-unread-count"));
  const change = page.locator("li[data-notification-id]").filter({
    has: page.getByRole("heading", { name: "Пара перенесена", exact: true }),
  });
  await expect(change).toContainText("13:00");
  await change.getByRole("link", { name: "Открыть расписание" }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(bell).toHaveAttribute("data-unread-count", String(before - 1));
  await page.goto("/notifications");
  const digest = page.getByRole("button", { name: /^Дайджест/ });
  await expect(digest).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("heading", { name: notificationTitle, exact: true }),
  ).toBeHidden();
  await digest.click();
  await expect(
    page.getByRole("heading", { name: notificationTitle, exact: true }),
  ).toBeVisible();
  await expect(digest).toHaveAttribute("aria-expanded", "true");
  await digest.click();
  await expect(
    page.getByRole("heading", { name: notificationTitle, exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Новости деканата", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Пара перенесена", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await page
    .getByRole("button", { name: "Прочитать все", exact: true })
    .click();
  await expect(bell).toHaveAttribute("data-unread-count", "0");
  await expect(
    page.getByRole("button", { name: "Прочитать все", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator("header a[href='/notifications']"),
  ).toHaveAccessibleName("Уведомления: 0 непрочитанных");
});

test("новое уведомление и счётчик появляются без перезагрузки страницы", async ({
  page,
  loginAs,
  students,
  notificationsData,
  notificationTitle,
}) => {
  await loginAs("anna");
  await page.goto("/notifications");
  const bell = page.locator("header [data-unread-count]");
  await expect(bell).toBeVisible();
  const before = Number(await bell.getAttribute("data-unread-count"));
  await page.evaluate(() => {
    document.documentElement.dataset.notificationsDocument = "same-document";
  });
  await notificationsData.insert({ title: notificationTitle });
  await notificationsData.insert({
    title: `${notificationTitle} · другому студенту`,
    userId: (await students.get("timur")).actor.userId,
  });
  await expect(
    page
      .locator("[data-sonner-toast]")
      .getByText(notificationTitle, { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(bell).toHaveAttribute("data-unread-count", String(before + 1));
  await expect(
    page.getByRole("heading", { name: notificationTitle, exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-notifications-document",
    "same-document",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`уведомления: axe, ширина и снимки · ${theme}`, async ({
    page,
    loginAs,
    notificationsData,
    notificationTitle,
  }, info) => {
    await notificationsData.insert({
      title: notificationTitle,
      priority: "low",
    });
    const viewport =
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAs("anna");
    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", { name: "Уведомления", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await mkdir(resolve("docs/screenshots"), { recursive: true });
    for (const state of ["collapsed", "expanded"] as const) {
      if (state === "expanded")
        await page.getByRole("button", { name: /^Дайджест/ }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
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
        path: resolve(
          `docs/screenshots/notifications-${state}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}
