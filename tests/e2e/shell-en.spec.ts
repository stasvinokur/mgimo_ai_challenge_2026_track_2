import { expect, type Page, test } from "@playwright/test";
import { loginMessages } from "../../src/ui/i18n/dictionaries/login";
import { shellMessages } from "../../src/ui/i18n/dictionaries/shell";
import { t } from "../../src/ui/i18n/translate";
import { requireAuthDatabase } from "../security/login";
import { captureScreenshot } from "./screenshot";

async function signIn(page: Page, name: string, account: string) {
  await page
    .getByRole("button", {
      name: t("en", loginMessages, "demoAccount", { name }),
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(t("en", loginMessages, "login"), { exact: true }),
  ).toHaveValue(account);
  await page
    .getByRole("button", {
      name: t("en", loginMessages, "submit"),
      exact: true,
    })
    .click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function expectUnbrokenControls(page: Page) {
  const controls = page.locator(
    'button, a[data-slot="button"], .nav-link, .header-icon, select',
  );
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const label = (await control.textContent())?.trim() ?? "";
    const box = await control.boundingBox();
    expect(box?.width, label).toBeGreaterThanOrEqual(44);
    expect(box?.height, label).toBeGreaterThanOrEqual(44);
    const metrics = await control.evaluate((element) => {
      const brokenWords: string[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(".sr-only, option")) continue;
        for (const match of (node.textContent ?? "").matchAll(
          /[A-Za-zА-Яа-яЁё]+/g,
        )) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = [...range.getClientRects()].filter(
            (rect) => rect.width > 0 && rect.height > 0,
          );
          if (lines.length > 1) brokenWords.push(match[0]);
        }
      }
      return {
        width: element.clientWidth,
        content: element.scrollWidth,
        brokenWords,
      };
    });
    expect(metrics.content, label).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.brokenWords, label).toEqual([]);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`English: вход и оболочка, ${theme}, axe и границы экрана`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    requireAuthDatabase();
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 },
    );
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await context.addCookies([
      { name: "pulse-language", value: "en", url: baseURL },
    ]);
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      page.getByRole("heading", {
        name: t("en", loginMessages, "title"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Language", { exact: true })).toHaveValue(
      "en",
    );
    await expect(page.getByRole("contentinfo")).toContainText(
      t("en", shellMessages, "competitionConcept"),
    );
    await expectUnbrokenControls(page);
    await captureScreenshot(page, info.outputPath(`login-en-${theme}.png`), {
      fullPage: true,
    });

    await signIn(page, "Анна", "anna");
    await page.goto("/today");
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "Today", level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
    const navigation = page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .filter({ visible: true });
    for (const name of [
      "Today",
      "Schedule",
      "Studies",
      "Requests",
      "Profile",
    ]) {
      const link = navigation.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      expect(await link.getAttribute("aria-label")).toBeNull();
    }
    await expect(
      page.getByRole("link", { name: "Skip to content", exact: true }),
    ).toHaveAttribute("href", "#main-content");
    await expect(
      page.getByRole("button", { name: "Switch theme", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: /^Notifications/ }),
    ).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText(
      t("en", shellMessages, "competitionConcept"),
    );
    await expectUnbrokenControls(page);
    await captureScreenshot(page, info.outputPath(`shell-en-${theme}.png`), {
      fullPage: true,
    });
    await navigation
      .getByRole("link", { name: "Profile", exact: true })
      .click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole("region", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expectUnbrokenControls(page);
    expect(errors).toEqual([]);
  });
}

test("English: неизвестный маршрут даёт переведённую страницу 404", async ({
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
  await signIn(page, "Анна", "anna");
  const response = await page.goto("/missing-section");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to Today", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
});

for (const account of [
  {
    name: "Марина",
    login: "marina",
    path: "/staff/requests",
    title: "Заявки студентов",
  },
  { name: "Олег", login: "oleg", path: "/teacher", title: "Мои пары" },
]) {
  test(`English: ${account.login} видит русский кабинет и пометку`, async ({
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
    await signIn(page, account.name, account.login);
    await page.goto(account.path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { level: 1, name: account.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("This interface is available in Russian.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Основная навигация", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
  });
}

test.describe("English SSR без JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("вход отрисован сервером на языке cookie, CSP и nonce сохранены", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    await context.addCookies([
      { name: "pulse-language", value: "en", url: baseURL },
    ]);
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { name: "Sign in to Pulse", exact: true }),
    ).toBeVisible();
    const policy = response?.headers()["content-security-policy"] ?? "";
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    for (const script of await page.locator("script:not([src])").all())
      expect(
        await script.evaluate(
          (element) => (element as HTMLScriptElement).nonce,
        ),
      ).toBe(nonce);
  });
});
