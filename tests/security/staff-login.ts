import { expect, type Page } from "@playwright/test";

export async function loginAsTestStaff(
  page: Page,
  credentials: { login: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/requests$/);
}
