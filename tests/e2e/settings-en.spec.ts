import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Route, test } from "@playwright/test";
import { loginAs, requireAuthDatabase } from "../security/login";

async function selectLanguage(select: Locator, language: "ru" | "en") {
  await expect(select).toHaveAttribute("data-language-ready", "true");
  await expect(select).toBeEnabled();
  await select.selectOption(language);
}

for (const path of ["/login", "/profile"] as const) {
  test(`English: ${path}, выбор языка заблокирован до гидратации`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    if (path === "/profile") await loginAs(page, "anna");
    await context.addCookies([
      { name: "pulse-language", value: "en", url: baseURL },
    ]);
    const scripts = Promise.withResolvers<void>();
    async function holdScript(route: Route) {
      if (route.request().resourceType() === "script") await scripts.promise;
      await route.continue();
    }
    await page.route("**/_next/static/**", holdScript);
    const select = page.getByLabel("Language", { exact: true });
    try {
      const response = await page.goto(path, { waitUntil: "commit" });
      expect(response?.status()).toBe(200);
      await expect(select).toHaveAttribute("data-language-ready", "false");
      await expect(select).toBeDisabled();
      await select.focus();
      await expect(select).not.toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(select).toHaveValue("en");
      expect(
        (await context.cookies()).find(
          (cookie) => cookie.name === "pulse-language",
        )?.value,
      ).toBe("en");
      scripts.resolve();
      await expect(select).toHaveAttribute("data-language-ready", "true");
      await expect(select).toBeEnabled();
      await page.waitForLoadState("load");
      await selectLanguage(select, "ru");
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      const russianSelect = page.getByLabel("Язык", { exact: true });
      await expect(russianSelect).toHaveAttribute(
        "data-language-ready",
        "true",
      );
      await expect(russianSelect).toBeEnabled();
      await expect(russianSelect).toHaveValue("ru");
      expect(
        (await context.cookies()).find(
          (cookie) => cookie.name === "pulse-language",
        )?.value,
      ).toBe("ru");
    } finally {
      scripts.resolve();
      await page.unroute("**/_next/static/**", holdScript);
    }
  });
}

test("English: выбор языка на входе и в настройках переживает перезагрузку и выход", async ({
  page,
  context,
  baseURL,
}) => {
  requireAuthDatabase();
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await selectLanguage(page.getByLabel("Language", { exact: true }), "ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("heading", { name: "Вход в «Пульс»", exact: true }),
  ).toBeVisible();
  await selectLanguage(page.getByLabel("Язык", { exact: true }), "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Sign in to Pulse", exact: true }),
  ).toBeVisible();
  // The reload after switching language must hydrate before the demo button works.
  await expect(page.getByLabel("Language", { exact: true })).toHaveAttribute(
    "data-language-ready",
    "true",
  );
  await page
    .getByRole("button", { name: "Sign in as Анна", exact: true })
    .click();
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
    "anna",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "Settings", exact: true });
  await expect(card).toHaveAttribute("data-settings-ready", "true");
  await expect(card.getByLabel("Language", { exact: true })).toHaveValue("en");
  for (const name of ["Larger text", "High contrast", "Less motion"]) {
    const toggle = card.getByRole("switch", { name, exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await toggle.getAttribute("aria-label")).toBeNull();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await expect
    .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
    .toEqual([]);
  await selectLanguage(card.getByLabel("Language", { exact: true }), "ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  const russianCard = page.getByRole("region", {
    name: "Настройки",
    exact: true,
  });
  await expect(
    russianCard.getByRole("switch", { name: "Крупный текст", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await selectLanguage(russianCard.getByLabel("Язык", { exact: true }), "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(card).toHaveAttribute("data-settings-ready", "true");
  await expect(card.getByLabel("Language", { exact: true })).toHaveValue("en");
  for (const name of ["Larger text", "High contrast", "Less motion"])
    await expect(
      card.getByRole("switch", { name, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  const cookie = (await context.cookies()).find(
    (value) => value.name === "pulse-language",
  );
  expect(cookie).toMatchObject({
    value: "en",
    path: "/",
    sameSite: "Lax",
    httpOnly: false,
    secure: new URL(page.url()).protocol === "https:",
  });
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 360 * 86400);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Sign in to Pulse", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
});

test("неизвестная языковая cookie сохраняет русский интерфейс", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies([
    { name: "pulse-language", value: "en-US", url: baseURL },
  ]);
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByLabel("Язык", { exact: true })).toHaveValue("ru");
  await expect(
    page.getByRole("heading", { name: "Вход в «Пульс»", exact: true }),
  ).toBeVisible();
});
