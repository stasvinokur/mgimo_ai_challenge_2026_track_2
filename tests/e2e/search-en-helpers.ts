import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import type { StudentTestData } from "../integration/student-e2e-data";

export async function englishStudent(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
  credentials: StudentTestData["credentials"],
) {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Username", { exact: true }).fill(credentials.login);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
}

export async function englishViewport(page: Page, info: TestInfo) {
  await page.setViewportSize(
    info.project.name === "mobile-360"
      ? { width: 360, height: 740 }
      : { width: 1440, height: 900 },
  );
}

export async function noHorizontalOverflow(page: Page, area: Locator) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await area.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  for (const text of await area.locator("h1, h2, h3, p, a, button").all()) {
    await expect(text).toHaveCSS("overflow-wrap", "normal");
    await expect(text).toHaveCSS("word-break", "normal");
  }
}
