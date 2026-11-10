import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  browserJson,
  expect,
  type PasskeyDTO,
  registerKey,
  test,
} from "../security/passkey-fixture";

const moscowDate = (value: string) =>
  `${new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value))} МСК`;

for (const role of ["student", "staff"] as const) {
  test.describe(`ключи доступа · ${role}`, () => {
    test.use({ passkeyRole: role });

    test("регистрация → выход → вход по ключу → удаление, даты МСК и доступность на 360 px", async ({
      page,
      context,
      passkeyAccount: account,
      authenticator,
    }, info) => {
      expect(authenticator.id).toBeTruthy();
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto("/login");
      await expect(page.getByLabel("Логин", { exact: true })).toHaveAttribute(
        "autocomplete",
        "username webauthn",
      );
      const loginButton = page.getByRole("button", {
        name: "Войти с ключом доступа",
        exact: true,
      });
      await expect(loginButton).toBeVisible();
      await expectReadableButton(loginButton);
      await expectAccessibleScreen(page);
      await info.attach(`passkey-login-${role}-360`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }),
        contentType: "image/png",
      });

      await account.login(page);
      await page.goto(account.profile);
      const card = page.getByRole("region", {
        name: "Ключи доступа",
        exact: true,
      });
      await expect(card.getByText(/^Ключей доступа пока нет\./)).toBeVisible();
      const deviceName = `Учебный телефон · ${role}`;
      const key = await registerKey(page, deviceName);
      expect(key.lastUsedAt).toBeNull();
      const row = card.getByRole("listitem").filter({ hasText: deviceName });
      await expect(row.locator("time")).toHaveCount(1);
      await expect(row.locator("time").first()).toHaveAttribute(
        "datetime",
        key.createdAt,
      );
      await expect(row.locator("time").first()).toHaveText(
        moscowDate(key.createdAt),
      );
      await expect(row).toContainText("Ещё не использовался");
      for (const button of await card.getByRole("button").all())
        await expectReadableButton(button);
      await expectAccessibleScreen(page);
      await info.attach(`passkey-profile-${role}-360`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }),
        contentType: "image/png",
      });

      await page.getByRole("button", { name: "Выйти", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(
        (await context.cookies()).some(
          (cookie) => cookie.name === "__Host-pulse-session",
        ),
      ).toBe(false);
      let reachedVerification = () => {};
      let releaseVerification = () => {};
      const reached = new Promise<void>((resolve) => {
        reachedVerification = resolve;
      });
      const held = new Promise<void>((resolve) => {
        releaseVerification = resolve;
      });
      const verificationRoute = "**/api/passkeys/authentication/verify";
      await page.route(verificationRoute, async (route) => {
        reachedVerification();
        await held;
        await route.continue();
      });
      try {
        await page
          .getByRole("button", {
            name: "Войти с ключом доступа",
            exact: true,
          })
          .click();
        await reached;
        await expect(page.getByLabel("Логин", { exact: true })).toBeDisabled();
        await expect(page.getByLabel("Пароль", { exact: true })).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Войти", exact: true }),
        ).toBeDisabled();
        const demos = page.getByRole("button", { name: /^Войти как / });
        await expect(demos).toHaveCount(4);
        for (const button of await demos.all())
          await expect(button).toBeDisabled();
      } finally {
        releaseVerification();
      }
      await expect(page).toHaveURL(new RegExp(`${account.home}$`));
      await page.unroute(verificationRoute);
      const session = (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-pulse-session",
      );
      expect(session).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
      });

      await page.goto(account.profile);
      const response = await browserJson<{ credentials: PasskeyDTO[] }>(
        page,
        "/api/passkeys",
      );
      expect(response.status).toBe(200);
      const used = response.body.credentials.find(
        (credential) => credential.id === key.id,
      );
      expect(used?.lastUsedAt).toBeTruthy();
      if (!used?.lastUsedAt)
        throw new Error("Не сохранена дата входа по ключу.");
      await expect(row.locator("time")).toHaveCount(2);
      await expect(row.locator("time").nth(1)).toHaveAttribute(
        "datetime",
        used.lastUsedAt,
      );
      await expect(row.locator("time").nth(1)).toHaveText(
        moscowDate(used.lastUsedAt),
      );
      await row.getByRole("button", { name: /^Удалить/ }).click();
      await expect(card.getByText(/^Ключей доступа пока нет\./)).toBeVisible();
      const empty = await browserJson<{ credentials: PasskeyDTO[] }>(
        page,
        "/api/passkeys",
      );
      expect(empty).toEqual({
        status: 200,
        body: { credentials: [], isDemoAccount: false },
      });
      await expectAccessibleScreen(page);
    });
  });
}

test.describe("автозаполнение ключа доступа", () => {
  test.use({ passkeyConditionalAutofill: true });

  test("conditional mediation обновляет challenge до истечения и оставляет вход по паролю доступным", async ({
    page,
  }) => {
    test.skip(!process.env.DATABASE_URL, "Нужна тестовая БД лейна.");
    await page.clock.install({ time: new Date("2026-11-05T10:00:00Z") });
    await holdConditionalAuthentication(page);
    const options = () =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/passkeys/authentication/options" &&
          response.request().method() === "POST",
      );
    const first = options();
    await page.goto("/login");
    expect((await first).status()).toBe(200);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __passkeyAutofillTest: { calls: unknown[] };
              }
            ).__passkeyAutofillTest.calls.length,
        ),
      )
      .toBe(1);
    await expect(page.getByLabel("Логин", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Пароль", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
    const second = options();
    await page.clock.fastForward(240_001);
    expect((await second).status()).toBe(200);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __passkeyAutofillTest: { calls: unknown[] };
              }
            ).__passkeyAutofillTest.calls.length,
        ),
      )
      .toBe(2);
    const state = await page.evaluate(
      () =>
        (
          window as unknown as {
            __passkeyAutofillTest: {
              calls: { mediation: string; uv: string }[];
              aborted: number;
            };
          }
        ).__passkeyAutofillTest,
    );
    expect(state.calls).toEqual([
      { mediation: "conditional", uv: "required" },
      { mediation: "conditional", uv: "required" },
    ]);
    expect(state.aborted).toBe(1);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Логин", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
  });

  test("30 открытий входа без XFF не мешают входу по паролю и настоящему ключу", async ({
    page,
    context,
    passkeyAccount: account,
    authenticator,
  }) => {
    test.setTimeout(120_000);
    expect(authenticator.id).toBeTruthy();
    await context.setExtraHTTPHeaders({});
    await holdConditionalAuthentication(page);
    await account.login(page);
    await page.goto(account.profile);
    await registerKey(page, "Телефон после 30 открытий входа");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    for (let opening = 0; opening < 30; opening++) {
      const options = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/passkeys/authentication/options" &&
          response.request().method() === "POST",
      );
      await page.goto("/login");
      expect((await options).status()).toBe(200);
      await expect
        .poll(async () => (await conditionalState(page)).calls.length)
        .toBe(1);
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    }
    await account.login(page);
    await expect(page).toHaveURL(new RegExp(`${account.home}$`));
    await page.goto(account.profile);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page
      .getByRole("button", { name: "Войти с ключом доступа", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${account.home}$`));
  });

  test("автоматическая ошибка options молчит, явная кнопка показывает общую ошибку", async ({
    page,
  }) => {
    await holdConditionalAuthentication(page);
    await page.route("**/api/passkeys/authentication/options", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "PASSKEY_LOGIN_FAILED" } }),
      }),
    );
    const failedOptions = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        "/api/passkeys/authentication/options",
    );
    await page.goto("/login");
    await (await failedOptions).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const main = page.getByRole("main");
    await expect(main.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Логин", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Войти с ключом доступа", exact: true })
      .click();
    await expect(main.getByRole("alert")).toHaveText(
      "Не удалось войти с ключом доступа. Попробуйте снова или войдите по паролю.",
    );
    await expect(
      page.getByRole("button", { name: "Войти с ключом доступа", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Пароль", { exact: true })).toBeEnabled();
  });
});

interface ConditionalState {
  calls: { mediation: string | undefined; uv: string | undefined }[];
  aborted: number;
}

async function conditionalState(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __passkeyAutofillTest: ConditionalState })
        .__passkeyAutofillTest,
  );
}

async function holdConditionalAuthentication(page: Page) {
  await page.addInitScript(() => {
    const state: ConditionalState = { calls: [], aborted: 0 };
    const originalGet = navigator.credentials.get.bind(navigator.credentials);
    Object.defineProperty(window, "__passkeyAutofillTest", { value: state });
    Object.defineProperty(navigator.credentials, "get", {
      configurable: true,
      value: (options?: CredentialRequestOptions) => {
        if (options?.mediation !== "conditional") return originalGet(options);
        state.calls.push({
          mediation: options.mediation,
          uv: options.publicKey?.userVerification,
        });
        return new Promise<Credential | null>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              state.aborted++;
              reject(new DOMException("Запрос отменён", "AbortError"));
            },
            { once: true },
          );
        });
      },
    });
  });
}

async function expectReadableButton(button: Locator) {
  await expect(button).toBeVisible();
  const metrics = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      contentHeight:
        element.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom),
      lineHeight: Number.parseFloat(style.lineHeight),
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      width: box.width,
      height: box.height,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.lineHeight * 2);
  expect(metrics.overflowWrap).toBe("normal");
  expect(metrics.wordBreak).toBe("normal");
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
}

async function expectAccessibleScreen(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
