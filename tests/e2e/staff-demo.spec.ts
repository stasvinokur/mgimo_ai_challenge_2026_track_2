import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "@playwright/test";
import { staffCommentOptions } from "@/application/staff/dto";
import {
  type DemoStaffFixture,
  openDemoStaffFixture,
} from "../integration/staff-demo-fixture";
import { loginAsTestStaff } from "../security/staff-login";

const test = base.extend<{ demoStaff: DemoStaffFixture }>({
  demoStaff: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна тестовая БД.");
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openDemoStaffFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
});

for (const to of ["needs_info", "rejected"] as const)
  test(`демо-сотрудник: ${to} отправляет выбранный комментарий; форма доступна`, async ({
    page,
    demoStaff: fixture,
  }) => {
    const id = await fixture.request();
    await fixture.change.execute(fixture.marina, { id, to: "accepted" });
    await fixture.change.execute(fixture.marina, { id, to: "in_progress" });
    await loginAsTestStaff(page, fixture.marinaCredentials);
    await page.goto(`/staff/requests/${id}`);
    const label = to === "needs_info" ? "Нужна информация" : "Отклонить";
    await page.getByRole("button", { name: label, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: label });
    const field = dialog.getByLabel("Комментарий (обязательно)");
    await expect(field).toHaveAttribute("readonly", "");
    const option = staffCommentOptions[to][0];
    await dialog.getByLabel("Шаблон комментария").selectOption(option.code);
    await expect(field).toHaveValue(option.label);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog
      .getByRole("button", { name: "Проверить комментарий", exact: true })
      .click();
    await expect(dialog).toContainText(option.label);
    await dialog
      .getByRole("button", { name: "Подтвердить отправку", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("[aria-current=step]")).toContainText(
      option.label,
    );
    expect(
      (await fixture.get.execute(fixture.marina, { id })).events.at(-1)
        ?.comment,
    ).toBe(option.label);
  });

test("обычный сотрудник редактирует шаблон перед отправкой", async ({
  page,
  demoStaff: fixture,
}) => {
  const id = await fixture.request();
  await fixture.change.execute(fixture.limited, { id, to: "accepted" });
  await fixture.change.execute(fixture.limited, { id, to: "in_progress" });
  await loginAsTestStaff(page, fixture.limitedCredentials);
  await page.goto(`/staff/requests/${id}`);
  await page
    .getByRole("button", { name: "Нужна информация", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Нужна информация" });
  const field = dialog.getByLabel("Комментарий (обязательно)");
  await expect(field).toBeEditable();
  const comment = "Уточните название учебного мероприятия.";
  await field.fill(comment);
  await dialog
    .getByRole("button", { name: "Проверить комментарий", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Подтвердить отправку", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("[aria-current=step]")).toContainText(comment);
});
