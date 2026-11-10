import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/student-login";

test("Анна: Сегодня, прогноз семестра, граница 76/77, пропуск ничего не сохраняет", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await expect(page.getByTestId("scholarship-summary")).toContainText(
    "Повышенная стипендия под угрозой",
  );
  await page
    .getByRole("link", { name: "Открыть успеваемость", exact: true })
    .click();
  await expect(page).toHaveURL(/\/grades$/);
  const forecast = page.getByTestId("scholarship-forecast");
  await expect(forecast.getByTestId("scholarship-headline")).toContainText(
    "Повышенная стипендия под угрозой",
  );
  await expect(forecast).toContainText("не меньше 77 из 100");
  await expect(
    page.getByRole("link", { name: "Почему? Правила стипендии", exact: true }),
  ).toHaveCount(1);
  await expect(
    forecast.getByRole("link", { name: "Почему? Правила стипендии" }),
  ).toHaveAttribute("href", "/regulations/scholarship#p-2");
  const explanation = forecast.getByRole("group", {
    name: "Как считается стипендия",
  });
  await expect(explanation).not.toHaveAttribute("open");
  await expect(explanation.getByText(/считаются как 0/)).toBeHidden();
  await explanation.locator("summary").click();
  await expect(explanation.getByText(/считаются как 0/)).toBeVisible();
  await explanation.locator("summary").click();
  await forecast
    .getByRole("link", {
      name: "Открыть дисциплину «Иностранный язык»",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
  const courseURL = page.url();
  const before = await (await page.request.get(`${courseURL}/data`)).json();
  const slider = page.getByRole("slider");
  await expect(slider).toHaveValue("77");
  await expect(forecast).toContainText("Повышенная стипендия сохраняется.");
  await slider.focus();
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("76");
  await expect(forecast.getByTestId("scholarship-headline")).toContainText(
    "Повышенная стипендия под угрозой",
  );
  await expect(forecast).toContainText("Повышенная стипендия под угрозой");
  await expect(forecast).toContainText("Итог ниже 86");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("77");
  await expect(forecast).toContainText("Повышенная стипендия сохраняется.");
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await expect(slider).toBeDisabled();
  await expect(forecast).toContainText("Нужно закрыть долг");
  await expect(forecast).toContainText("Долг по обязательной работе");
  await page.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(forecast).toContainText("Повышенная стипендия сохраняется.");
  expect(await (await page.request.get(`${courseURL}/data`)).json()).toEqual(
    before,
  );
  await page.reload();
  await expect(slider).toHaveValue("77");
});

test("Тимур видит дисциплину и долг как причину отсутствия стипендии", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  await page.goto("/grades");
  const forecast = page.getByTestId("scholarship-forecast");
  await expect(forecast).toContainText("Пока без стипендии");
  await expect(forecast).toContainText("Основы маркетинга");
  await expect(forecast).toContainText("Долг по обязательной работе");
  await expect(forecast).toContainText(
    "Согласуйте с преподавателем сдачу долга",
  );
});

for (const theme of ["light", "dark"] as const) {
  for (const screen of ["anna", "anna-course", "timur", "today"] as const) {
    test(`снимок и axe стипендии: ${screen}, ${theme}`, async ({
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
      await loginAs(screen === "timur" ? "timur" : "anna");
      if (screen !== "today") {
        await page.goto("/grades");
        await expect(page.getByTestId("scholarship-forecast")).toBeVisible();
        if (screen === "anna-course") {
          await page
            .getByTestId("grade-course")
            .first()
            .getByRole("link", { name: /Подробнее/ })
            .click();
          await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
          await expect(page.getByRole("slider")).toHaveValue("77");
        }
      } else
        await expect(page.getByTestId("scholarship-summary")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      for (const link of await page
        .getByTestId("scholarship-forecast")
        .getByRole("link")
        .all()) {
        const box = await link.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
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
          `docs/screenshots/scholarship-${screen}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
