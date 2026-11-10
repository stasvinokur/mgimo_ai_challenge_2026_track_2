import { expect, test } from "@playwright/test";
import { loginAs } from "../security/login";
import { conceptNotice } from "./shell-cases";

test("главная перенаправляет в «Сегодня» с конкурсной плашкой", async ({
  page,
}) => {
  await loginAs(page, "anna");
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page).toHaveTitle("Сегодня · Пульс");
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("contentinfo")).toHaveText(`П${conceptNotice}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});
