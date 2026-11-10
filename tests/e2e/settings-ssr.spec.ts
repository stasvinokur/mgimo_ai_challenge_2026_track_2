import { expect, test } from "@playwright/test";

const cookies = [
  { name: "pulse-large-text", className: "a11y-large-text" },
  { name: "pulse-high-contrast", className: "a11y-high-contrast" },
  { name: "pulse-reduced-motion", className: "a11y-reduced-motion" },
];

test.use({ javaScriptEnabled: false });

test("cookie применяются к серверному html страницы входа до JavaScript", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies(
    cookies.map(({ name }) => ({ name, value: "on", url: baseURL })),
  );
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  for (const cookie of cookies)
    await expect(page.locator("html")).toHaveClass(
      new RegExp(cookie.className),
    );
  expect(
    await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("20px");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("'unsafe-eval'");
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  for (const script of await page.locator("script:not([src])").all())
    expect(
      await script.evaluate((element) => (element as HTMLScriptElement).nonce),
    ).toBe(nonce);
});

test("неизвестные и подменённые значения cookie не попадают в html", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  const values = ["ON", "on%22%20data-settings-injected%3D%22yes", "yes"];
  await context.addCookies(
    cookies.map(({ name }, index) => ({
      name,
      value: values[index] ?? "invalid",
      url: baseURL,
    })),
  );
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  for (const cookie of cookies)
    await expect(page.locator("html")).not.toHaveClass(
      new RegExp(cookie.className),
    );
  await expect(page.locator("[data-settings-injected]")).toHaveCount(0);
  expect(await response?.text()).not.toContain("data-settings-injected");
  expect(
    await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("16px");
});
