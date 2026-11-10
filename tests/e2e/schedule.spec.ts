import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginAs } from "../security/login";

test("360 px: видимый регистр дат совпадает с доступным текстом в обоих видах", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await loginAs(page, "anna");
  const response = await page.goto("/schedule?view=today");
  const serverDate = response?.headers().date;
  if (!serverDate) throw new Error("Нет времени ответа сервера.");
  const label = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(serverDate));
  const expected = `${label.charAt(0).toLocaleUpperCase("ru-RU")}${label.slice(1)} · сегодня`;
  const heading = page.getByRole("heading", {
    level: 2,
    name: expected,
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveAccessibleName(expected);
  await expect(heading).toHaveText(expected, { useInnerText: true });
  await expect(heading).toHaveCSS("text-transform", "none");
  await page.getByRole("link", { name: "Неделя", exact: true }).click();
  await expect(page).toHaveURL(/\/schedule\?view=week&week=\d{4}-W\d{2}$/);
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(expected, { useInnerText: true });
  // Day cards only: the week also has the «Личный календарь» card. Case-insensitive, so a wrong case is still checked below.
  const days = page.locator('[data-slot="card-title"] h2').filter({
    hasText:
      /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье),/i,
  });
  await expect(days).toHaveCount(7);
  for (const day of await days.all()) {
    const text = await day.textContent();
    if (!text) throw new Error("Нет заголовка дня.");
    await expect(day).toHaveText(text, { useInnerText: true });
    expect(text).toMatch(/^[А-ЯЁ][а-яё]+, \d{1,2} [а-яё]+(?: · сегодня)?$/);
    await expect(day).toHaveAccessibleName(text);
    await expect(day).toHaveCSS("text-transform", "none");
  }
  await page.evaluate(() => document.fonts.ready);
  await info.attach("Регистр дат · 360 px", {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
});

test("Анна видит перенос было → стало и переключает недели", async ({
  page,
}) => {
  await loginAs(page, "anna");
  await page.goto("/schedule");
  await expect(
    page.getByRole("heading", { name: "Расписание", exact: true, level: 1 }),
  ).toBeVisible();
  const sunday = new Date(Date.now() + 3 * 3_600_000).getUTCDay() === 0;
  if (sunday) {
    await expect(page.getByText("Занятий нет", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "К ближайшему учебному дню" }).click();
    await expect(page).toHaveURL(/\/schedule\?view=week&week=\d{4}-W\d{2}$/);
  }
  const changes = page.getByTestId("schedule-change");
  await expect(
    changes.filter({ hasText: "Перенесено на" }).first(),
  ).toContainText("09:00–10:30");
  await expect(
    changes.filter({ hasText: "Перенесено с" }).first(),
  ).toContainText("13:00–14:30");
  await expect(changes.first()).toContainText("→");
  await expect(changes.first()).toContainText("Причина:");
  await expect(page.locator("s").first()).toBeVisible();
  await page.getByRole("link", { name: "Неделя", exact: true }).click();
  await expect(page).toHaveURL(/week=\d{4}-W\d{2}/);
  const weekURL = page.url();
  await page
    .getByRole("link", { name: "Следующая неделя", exact: true })
    .first()
    .click();
  await expect(page).not.toHaveURL(weekURL);
  await page
    .getByRole("link", { name: "Предыдущая неделя", exact: true })
    .click();
  await expect(page).toHaveURL(weekURL);
});

for (const theme of ["light", "dark"] as const) {
  for (const view of ["today", "week"] as const) {
    test(`снимок и axe schedule-${view}-${theme}`, async ({ page }, info) => {
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
      await loginAs(page, "anna");
      await page.goto(`/schedule?view=${view}`);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        page.getByRole("heading", {
          name: "Расписание",
          level: 1,
          exact: true,
        }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await mkdir(resolve("docs/screenshots"), { recursive: true });
      await page.screenshot({
        path: resolve(
          "docs/screenshots",
          `schedule-${view}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
