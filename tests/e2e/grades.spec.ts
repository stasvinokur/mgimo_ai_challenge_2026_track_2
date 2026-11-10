import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/student-login";

test("компактный список Анны ведёт к прогнозу с начальным баллом 77", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/grades");
  const courses = page.getByTestId("grade-course");
  await expect(courses).toHaveCount(6);
  await expect(courses.first().getByRole("heading")).toHaveText(
    "Иностранный язык",
  );
  await expect(courses.first()).toContainText("На грани");
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Работы и сроки" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Сессия", exact: true }),
  ).toHaveCount(0);
  const explanations = page.locator("details");
  await expect(explanations).toHaveCount(2);
  for (const explanation of await explanations.all()) {
    await expect(
      explanation.getByText("Как считается?", { exact: true }),
    ).toBeVisible();
    await expect(explanation).not.toHaveAttribute("open");
  }
  await courses
    .first()
    .getByRole("link", { name: /Подробнее/ })
    .click();
  await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
  const courseURL = page.url();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Иностранный язык",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Работы и сроки", exact: true }),
  ).toBeVisible();
  const course = page.getByTestId("grade-course");
  await expect(course).toContainText("Нужно ≥ 77 из 100");
  const before = await (await page.request.get(`${courseURL}/data`)).json();
  const slider = course.getByRole("slider");
  await expect(slider).toHaveValue("77");
  await expect(course.getByRole("status")).toContainText("86 из 100 — отлично");
  await slider.focus();
  await slider.press("End");
  await expect(course.getByRole("status")).toContainText(
    "88,3 из 100 — отлично",
  );
  await slider.press("Home");
  await expect(course.getByRole("status")).toContainText(
    "78,3 из 100 — хорошо",
  );
  for (let step = 0; step < 77; step++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue("77");
  await expect(course.getByRole("status")).toContainText("86 из 100 — отлично");
  await course.getByRole("button", { name: "Пропустить", exact: true }).click();
  await expect(course.getByRole("status")).toContainText("78,3");
  await expect(slider).toBeDisabled();
  await course.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(course.getByRole("status")).toContainText("86 из 100");
  expect(await (await page.request.get(`${courseURL}/data`)).json()).toEqual(
    before,
  );
  await page.getByRole("link", { name: "Все дисциплины", exact: true }).click();
  await expect(page).toHaveURL(/\/grades$/);
});

test("Тимур видит обязательный долг первым", async ({ page, loginAs }) => {
  await loginAs("timur");
  await page.goto("/grades");
  const course = page.getByTestId("grade-course").first();
  await expect(course.getByRole("heading")).toHaveText("Основы маркетинга");
  await expect(course).toContainText("Есть долг");
  await expect(course).toContainText(
    "согласуйте срок сдачи обязательной работы",
  );
  await expect(course).toContainText("Просрочено");
  await expect(page.getByRole("main")).not.toContainText(
    "История международных отношений",
  );
});

for (const theme of ["light", "dark"] as const) {
  for (const screen of [
    { name: "anna", account: "anna", detail: false },
    { name: "timur", account: "timur", detail: false },
    { name: "anna-course", account: "anna", detail: true },
  ] as const) {
    test(`скриншот и axe: ${screen.name}, ${theme}`, async ({
      page,
      loginAs,
    }, info) => {
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
      await loginAs(screen.account);
      await page.goto("/grades");
      await expect(
        page.getByRole("heading", { level: 1, name: "Учёба", exact: true }),
      ).toBeVisible();
      if (screen.detail) {
        await page
          .getByTestId("grade-course")
          .first()
          .getByRole("link", { name: /Подробнее/ })
          .click();
        await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Иностранный язык",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole("slider")).toHaveValue("77");
      }
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await mkdir(resolve("docs/screenshots"), { recursive: true });
      await page.screenshot({
        path: resolve(
          `docs/screenshots/grades-${screen.name}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
