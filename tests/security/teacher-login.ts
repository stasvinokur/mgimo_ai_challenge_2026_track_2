import { expect, type Page } from "@playwright/test";

export {
  openTeacherTestData,
  type TeacherTestData,
} from "../integration/teacher-e2e-data";

export async function loginAsTestTeacher(
  page: Page,
  credentials: { login: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher$/);
}
