import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { cleanupRequestsForTest } from "../integration/requests-e2e-cleanup";
import {
  openStaffFixture,
  type StaffFixture,
} from "../integration/staff-fixtures";
import {
  test as base,
  expect,
  loginAsTestStudent,
} from "../security/student-login";

const test = base.extend<{
  requestDestination: string;
  requestStaff: StaffFixture;
}>({
  requestDestination: async ({ baseURL }, use) => {
    if (!baseURL)
      throw new Error("Для проверки заявок укажите адрес приложения.");
    const destination = `Учебный центр «Горизонт» · ${randomUUID()}`;
    try {
      await use(destination);
    } finally {
      await cleanupRequestsForTest(destination);
    }
  },
  requestStaff: async ({ baseURL }, use) => {
    base.skip(
      !process.env.DATABASE_URL,
      "Для подготовки ветки нужна тестовая БД.",
    );
    if (!baseURL)
      throw new Error("Для проверки заявок укажите адрес приложения.");
    const fixture = await openStaffFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
});

test("Тимур проверяет поля, сохраняет черновик, возвращается и отправляет справку", async ({
  page,
  loginAs,
  requestDestination,
}) => {
  await loginAs("timur");
  await page.goto("/requests/new");
  await expect(page.getByRole("link", { name: /^Выбрать:/ })).toHaveCount(9);
  await page
    .getByRole("link", { name: "Выбрать: Справка об обучении", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/new\?type=enrollment$/);
  await expect(page.getByText("Тимур Белов", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  await expect(
    page.getByText("Заполните это поле.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Место требования (обязательно)")
    .fill(requestDestination);
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Черновик сохранён");
  await page
    .getByRole("link", { name: "Открыть сохранённый черновик", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Место требования (обязательно)")).toHaveValue(
    requestDestination,
  );
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Проверьте заявку", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(requestDestination, { exact: true }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Подтвердить отправку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Что происходит?", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Подана", { exact: true })).toBeVisible();
  await expect(page.getByText(/^З-\d{4}-\d{6,}$/)).toBeVisible();
  await expect(page.getByText("Ожидаемая дата", { exact: true })).toBeVisible();
  const url = page.url();
  await page.goto("/requests");
  const card = page
    .locator("li")
    .filter({ has: page.locator(`a[href="${new URL(url).pathname}"]`) });
  await expect(card.getByText("Подана", { exact: true })).toBeVisible();
  await expect(card.getByText(/Ожидаемая дата:/)).toBeVisible();
});

test("Анна видит таймлайн готовой справки", async ({ page, loginAs }) => {
  await loginAs("anna");
  await page.goto("/requests");
  const card = page
    .locator("li")
    .filter({ has: page.getByText("Готова", { exact: true }) })
    .first();
  await card.getByRole("link", { name: "Отследить заявку" }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Путь заявки", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[aria-current=step]")).toContainText("Готова");
  await expect(page.locator("main time")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Отменить заявку" }),
  ).toHaveCount(0);
});

for (const branch of ["needs_info", "rejected"] as const)
  test(`ветка ${branch}: комментарий и ответ студента`, async ({
    page,
    requestStaff: f,
  }) => {
    expect(await f.repo.isDemoUser(f.marina.userId)).toBe(false);
    const id = await f.request();
    await f.change.execute(f.marina, { id, to: "accepted" });
    await f.change.execute(f.marina, { id, to: "in_progress" });
    const comment =
      branch === "needs_info"
        ? "Уточните место требования."
        : "Выберите справку о стипендии для этого обращения.";
    await f.change.execute(f.marina, { id, to: branch, comment });
    await loginAsTestStudent(page, f.studentCredentials.anna);
    await page.goto(`/requests/${id}`);
    await expect(page.getByText(comment, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Отменить заявку" }),
    ).toHaveCount(0);
    if (branch === "needs_info") {
      await page
        .getByLabel("Уточнение к заявке (обязательно)")
        .fill("В учебный центр «Горизонт»");
      await page
        .getByRole("button", { name: "Отправить ответ", exact: true })
        .click();
      await expect(page.locator("[aria-current=step]")).toContainText(
        "В работе",
      );
      await expect(page.locator("[aria-current=step]")).toContainText(
        "В учебный центр «Горизонт»",
      );
    } else
      await expect(page.locator("[aria-current=step]")).toContainText(
        "Отклонена",
      );
  });

for (const theme of ["light", "dark"] as const)
  test(`снимки requests и axe · ${theme}`, async ({ page, loginAs }, info) => {
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
    await mkdir(resolve("docs/screenshots"), { recursive: true });
    for (const screen of ["list", "catalog", "form", "tracker"] as const) {
      if (screen === "tracker") {
        await page.goto("/requests");
        await page
          .locator("li")
          .filter({ has: page.getByText("Готова", { exact: true }) })
          .first()
          .getByRole("link", { name: "Отследить заявку" })
          .click();
        await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
      } else
        await page.goto(
          screen === "list"
            ? "/requests"
            : screen === "catalog"
              ? "/requests/new"
              : "/requests/new?type=visa",
        );
      if (screen === "form") {
        await expect(
          page.getByLabel("Страна (необязательно)", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Страна (если известна) (необязательно)", {
            exact: true,
          }),
        ).toHaveCount(0);
      }
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
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
          `docs/screenshots/requests-${screen}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
