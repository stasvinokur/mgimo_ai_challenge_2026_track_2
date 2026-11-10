import { test as base, expect, type Page } from "@playwright/test";

export type DemoAccount = "anna" | "timur" | "marina" | "oleg";
const names = { anna: "Анна", timur: "Тимур", marina: "Марина", oleg: "Олег" };

export function requireAuthDatabase() {
  base.skip(
    !process.env.DATABASE_URL && !process.env.PLAYWRIGHT_BASE_URL,
    "DATABASE_URL не задан и готовый стек не указан: проверки входа пропущены.",
  );
}

export async function loginAs(page: Page, account: DemoAccount, next?: string) {
  requireAuthDatabase();
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page
    .getByRole("button", { name: `Войти как ${names[account]}`, exact: true })
    .click();
  await expect(page.getByLabel("Логин", { exact: true })).toHaveValue(account);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(
    account === "oleg"
      ? /\/teacher$/
      : account === "marina"
        ? /\/staff\/requests$/
        : /\/(today|profile|schedule)(?:\?|$)/,
  );
}

export const test = base.extend<{
  loginAs: (account: DemoAccount, next?: string) => Promise<void>;
}>({
  loginAs: async ({ page }, use) => {
    await use((account, next) => loginAs(page, account, next));
  },
});
export { expect };
