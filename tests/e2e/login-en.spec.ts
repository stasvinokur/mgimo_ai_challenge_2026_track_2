import { expect, test } from "@playwright/test";

test("English: кнопка и ошибка входа с ключом доступа", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
  await page.route("**/api/passkeys/authentication/options", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAVAILABLE" } }),
    }),
  );
  await page.goto("/login");
  const button = page.getByRole("button", {
    name: "Sign in with a passkey",
    exact: true,
  });
  await expect(button).toBeEnabled();
  expect(await button.getAttribute("aria-label")).toBeNull();
  await button.click();
  await expect(
    page
      .getByRole("main")
      .getByText(
        "Could not sign in with a passkey. Please try again or use your password.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(page.getByLabel("Username", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Password", { exact: true })).toBeEnabled();
});
