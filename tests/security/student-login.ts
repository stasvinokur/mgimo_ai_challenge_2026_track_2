import { test as base, expect, type Page } from "@playwright/test";
import {
  openStudentTestData,
  type StudentScenario,
  type StudentTestData,
} from "../integration/student-e2e-data";
import { type DemoAccount, loginAs as loginAsDemo } from "./login";

export async function loginAsTestStudent(
  page: Page,
  credentials: StudentTestData["credentials"],
) {
  await page.goto("/login");
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
}

export const test = base.extend<{
  students: {
    get(scenario: StudentScenario): Promise<StudentTestData>;
    login(page: Page, account: DemoAccount): Promise<void>;
  };
  loginAs: (account: DemoAccount) => Promise<void>;
}>({
  students: async ({ baseURL }, use) => {
    base.skip(
      !process.env.DATABASE_URL,
      "Для временного студента нужна БД лейна.",
    );
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const data = new Map<StudentScenario, StudentTestData>();
    async function get(scenario: StudentScenario) {
      let student = data.get(scenario);
      if (!student) {
        student = await openStudentTestData(scenario);
        data.set(scenario, student);
      }
      return student;
    }
    try {
      await use({
        get,
        async login(page, account) {
          if (account === "marina" || account === "oleg")
            return loginAsDemo(page, account);
          await loginAsTestStudent(page, (await get(account)).credentials);
        },
      });
    } finally {
      await Promise.all([...data.values()].map((student) => student.close()));
    }
  },
  loginAs: async ({ page, students }, use) => {
    await use((account) => students.login(page, account));
  },
});

export { expect };
