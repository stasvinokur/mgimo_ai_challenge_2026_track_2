import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/student-login";
import {
  expectTodayRingTone,
  expectTodayTypography,
  expectUniqueTodayControls,
} from "./today-controls";

test("Анна видит перенос, дисциплину на грани и готовую справку и открывает их в один тап", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/today");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Сейчас", exact: true }),
  ).toBeVisible();
  const change = page
    .getByTestId("today-change")
    .filter({ hasText: "Перенос" });
  await expect(change).toContainText("Было:");
  await expect(change).toContainText("→ Стало:");
  await expect(change).toContainText("13:00");
  await expect(
    main.getByRole("link", { name: "Открыть расписание", exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .getByTestId("today-action")
      .filter({ hasText: "Пара перенесена" })
      .getByRole("link"),
  ).toHaveAccessibleName(/^Посмотреть изменения.*Пара перенесена$/);
  await main
    .getByRole("link", { name: "Открыть расписание", exact: true })
    .click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByTestId("schedule-change").first()).toContainText(
    "13:00",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  const language = page
    .getByTestId("today-action")
    .filter({ hasText: "Иностранный язык — на грани" });
  await expect(language).toBeVisible();
  await language.getByRole("link").click();
  await expect(page).toHaveURL(
    /\/grades\/[0-9a-f-]+\?actions=1(?:&workId=[0-9a-f-]{36})?#course-actions$/,
  );
  await expect(page.getByTestId("course-actions")).toHaveAttribute("open", "");
  await expect(
    page.getByTestId("course-actions").locator("summary"),
  ).toContainText("Что можно сделать?");
  await expect(
    page.getByRole("heading", {
      name: "Иностранный язык",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  const certificate = page
    .getByTestId("today-action")
    .filter({ hasText: "Справка об обучении — готова" });
  await expect(certificate).toBeVisible();
  await certificate.getByRole("link").click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  await expect(page.getByRole("main")).toContainText("Готова");
});

test("Тимур видит долг первым и спокойное состояние без заявок", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  await page.goto("/today");
  const first = page.getByTestId("today-action").first();
  await expect(first).toContainText("Основы маркетинга — есть долг");
  await expect(first).toContainText("согласуйте срок сдачи");
  await expect(page.getByRole("main")).toContainText("Заявок пока нет");
  await expect(page.getByRole("main")).not.toContainText(
    "Справка об обучении — готова",
  );
  await first.getByRole("link").click();
  await expect(page).toHaveURL(
    /\/grades\/[0-9a-f-]+\?actions=1(?:&workId=[0-9a-f-]{36})?#course-actions$/,
  );
  await expect(page.getByTestId("course-actions")).toHaveAttribute("open", "");
  await expect(
    page.getByTestId("course-actions").locator("summary"),
  ).toContainText("Что можно сделать?");
  await expect(
    page.getByRole("heading", {
      name: "Основы маркетинга",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
});

test("подмена studentId и userId в query не меняет данные Анны", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/today");
  const certificate = page
    .getByTestId("today-action")
    .filter({ hasText: "Справка об обучении — готова" })
    .getByRole("link");
  await expect(certificate).toBeVisible();
  const ownLink = await certificate.getAttribute("href");
  await page.goto(
    "/today?studentId=00000000-0000-7000-8000-000000000002&userId=00000000-0000-7000-8000-000000000003",
  );
  await expect(
    page.getByRole("heading", { name: "Сегодня", level: 1, exact: true }),
  ).toBeVisible();
  await expect(certificate).toHaveAttribute("href", ownLink ?? "");
  await expect(page.getByRole("main")).toContainText(
    "Иностранный язык — на грани",
  );
  await expect(page.getByRole("main")).not.toContainText(
    "Основы маркетинга — есть долг",
  );
});

for (const theme of ["light", "dark"] as const) {
  for (const account of ["anna", "timur"] as const) {
    test(`Сегодня: ${account}, ${theme}, axe и снимок`, async ({
      page,
      loginAs,
    }, info) => {
      const viewport =
        info.project.name === "mobile-360"
          ? { width: 360, height: 740 }
          : { width: 1440, height: 900 };
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await loginAs(account);
      await page.goto("/today");
      await expect(
        page.getByRole("heading", { name: "Что дальше", exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("today-action").first()).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page.evaluate(() => document.fonts.ready);
      const main = page.getByRole("main");
      const gradesLink = main.getByRole("link", {
        name: "Открыть успеваемость",
        exact: true,
      });
      await expect(gradesLink).toHaveCount(1);
      await expect(gradesLink).toHaveAttribute("href", "/grades");
      await expect(
        main
          .getByTestId("today-study")
          .getByRole("link", { name: "Открыть успеваемость", exact: true }),
      ).toHaveCount(1);
      await expectUniqueTodayControls(main);
      await expectTodayTypography(main);
      await expectTodayRingTone(
        main,
        account === "timur" ? "danger" : "warning",
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(errors).toEqual([]);
      await mkdir(resolve("docs/screenshots"), { recursive: true });
      await page.screenshot({
        path: resolve(
          `docs/screenshots/today-${account}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
