import { demoAccounts } from "@/application/identity/demo-accounts";
import { loginMessages } from "@/ui/i18n/dictionaries/login";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { expect, registerKey, test } from "../security/passkey-fixture";
import { loginScriptsFromHtml, loginScriptUrl } from "./login-chunks";

// Override the passkey fixture's default origin for this second production server.
const publicURL =
  process.env.PLAYWRIGHT_PUBLIC_LOGIN_URL ||
  `http://localhost:${Number(process.env.PORT || "3000") + 10_000}`;
test.use({ baseURL: publicURL });

for (const language of ["ru", "en"] as const) {
  test(`публичный вход ${language}: HTML, RSC и JS-чанки страницы без демо-паролей`, async ({
    page,
    context,
    request,
  }) => {
    const chunks = new Set<string>();
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      const url = loginScriptUrl(response.url(), publicURL);
      if (url) chunks.add(url);
    });
    await context.addCookies([
      { name: "pulse-language", value: language, url: publicURL },
    ]);
    for (const rsc of [false, true]) {
      const response = await request.get("/login", {
        headers: {
          Cookie: `pulse-language=${language}`,
          Origin: publicURL,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": rsc ? "cors" : "navigate",
          "Sec-Fetch-Dest": rsc ? "empty" : "document",
          ...(rsc ? { RSC: "1" } : {}),
        },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain(
        rsc ? "text/x-component" : "text/html",
      );
      const body = await response.text();
      if (!rsc)
        for (const url of loginScriptsFromHtml(body, publicURL))
          chunks.add(url);
      for (const account of demoAccounts)
        expect(body.includes(account.password)).toBe(false);
      expect(body.includes("demo-2026")).toBe(false);
      expect(body.includes("Войти как")).toBe(false);
      expect(body.includes("Sign in as")).toBe(false);
      expect(body.includes(loginMessages.demoHint[language])).toBe(false);
    }
    await page.goto("/login");
    await expect(
      page.getByLabel(language === "ru" ? "Язык" : "Language", { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /^(Войти как|Sign in as) / }),
    ).toHaveCount(0);
    await expect(
      page.getByText(loginMessages.demoHint[language], { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel(loginMessages.login[language], { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel(loginMessages.password[language], { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: loginMessages.passkey[language],
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      page
        .getByRole("main")
        .getByText(shellMessages.competitionConcept[language], {
          exact: true,
        }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const loadedScripts = await page.evaluate(() => [
      ...Array.from(document.scripts, (script) => script.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ]);
    for (const script of loadedScripts) {
      const url = loginScriptUrl(script, publicURL);
      if (url) chunks.add(url);
    }
    expect(chunks.size).toBeGreaterThan(0);
    for (const url of chunks) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(200);
      const body = await response.text();
      for (const account of demoAccounts)
        expect(body.includes(account.password), url).toBe(false);
      expect(body.includes("demo-2026"), url).toBe(false);
    }
  });
}

test("публичный вход: язык и тема сохраняются после перезагрузки", async ({
  page,
}) => {
  await page.goto("/login");
  const language = page.getByLabel("Язык", { exact: true });
  await expect(language).toBeEnabled();
  const before = await page.locator("html").getAttribute("class");
  await page
    .getByRole("button", { name: "Переключить тему", exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("class", before ?? "");
  const after = await page.locator("html").getAttribute("class");
  await language.selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Sign in to Pulse", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("class", after ?? "");
  await expect(page.getByRole("button", { name: /^Sign in as / })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to Pulse", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("class", after ?? "");
  await page.getByLabel("Language", { exact: true }).selectOption("ru");
  await expect(
    page.getByRole("heading", { name: "Вход в «Пульс»", exact: true }),
  ).toBeVisible();
});

test("публичный вход: пароль → регистрация ключа → выход → вход по ключу", async ({
  page,
  passkeyAccount: account,
  authenticator,
}) => {
  expect(authenticator.id).toBeTruthy();
  await account.login(page);
  await page.goto(account.profile);
  await registerKey(page, "Учебный телефон");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /^Войти как / })).toHaveCount(
    0,
  );
  const button = page.getByRole("button", {
    name: "Войти с ключом доступа",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page).toHaveURL(/\/today$/);
});
