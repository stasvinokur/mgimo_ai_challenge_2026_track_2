import type { Locator, Page } from "@playwright/test";
import { appPath } from "@/ui/shared/app-path.mjs";
import { expect, test } from "../security/student-login";

const labels = {
  ru: {
    username: "Логин",
    password: "Пароль",
    signIn: "Войти",
    firstSteps: "Первые шаги",
    pushTitle: "Уведомления на телефон",
    enable: "Включить",
    passkeysTitle: "Ключи доступа",
    deviceName: "Название устройства",
    addKey: "Добавить ключ",
  },
  en: {
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    firstSteps: "First steps",
    pushTitle: "Phone notifications",
    enable: "Enable",
    passkeysTitle: "Passkeys",
    deviceName: "Device name",
    addKey: "Add passkey",
  },
} as const;

async function signIn(
  page: Page,
  credentials: { login: string; password: string },
  language: keyof typeof labels,
) {
  const text = labels[language];
  await page.goto("/login");
  await page.getByLabel(text.username, { exact: true }).fill(credentials.login);
  await page
    .getByLabel(text.password, { exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: text.signIn, exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  const card = page.getByRole("region", {
    name: text.firstSteps,
    exact: true,
  });
  await expect(card).toHaveAttribute("data-onboarding-ready", "true");
  return card;
}

async function expectBelowHeader(target: Locator) {
  await expect(target).toBeVisible();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const header = document.querySelector(".app-header");
        const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
        return bounds.top >= Math.max(0, headerBottom);
      }),
    )
    .toBe(true);
}

// The subscription browser API is deterministic; server configuration and onboarding stay real.
async function readyPushBrowser(page: Page) {
  await page.addInitScript(
    ({ scopePath, workerPath }) => {
      const scope = location.origin + scopePath;
      const active = Object.assign(new EventTarget(), {
        state: "activated",
        scriptURL: location.origin + workerPath,
        postMessage(message: unknown, ports: MessagePort[] = []) {
          if (
            message &&
            typeof message === "object" &&
            "type" in message &&
            message.type === "PULSE_CLEAR_PAGES"
          ) {
            ports[0]?.postMessage({ ok: true });
            ports[0]?.close();
          }
        },
      });
      const registration = Object.assign(new EventTarget(), {
        scope,
        active,
        pushManager: { getSubscription: async () => null },
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: Object.assign(new EventTarget(), {
          controller: active,
          ready: Promise.resolve(registration),
          getRegistration: async (clientURL = location.href) =>
            new URL(clientURL, location.href).href.startsWith(scope)
              ? registration
              : undefined,
          getRegistrations: async () => [registration],
          register: async () => registration,
        }),
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: class {},
      });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: { permission: "default" },
      });
    },
    { scopePath: appPath("/"), workerPath: appPath("/sw.js") },
  );
}

function responseGate() {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release: () => release() };
}

for (const language of ["ru", "en"] as const) {
  test.describe(`первые шаги в профиль: ${language}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      if (!baseURL) throw new Error("Нужен адрес приложения.");
      await context.addCookies([
        { name: "pulse-language", value: language, url: baseURL },
      ]);
    });

    test("шаг push открывает видимую карточку подписки в профиле", async ({
      page,
      students,
    }) => {
      await readyPushBrowser(page);
      const firstSteps = await signIn(
        page,
        (await students.get("timur")).credentials,
        language,
      );
      const configuration = await page.request.get("/api/push");
      expect(configuration.status()).toBe(200);
      const { publicKey } = await configuration.json();
      test.skip(!publicKey, "Шаг push требует настроенный VAPID на сервере.");
      await firstSteps
        .locator('[data-onboarding-step="push"]')
        .getByRole("link")
        .click();
      await expect(page).toHaveURL(/\/profile#push-notifications$/);
      const card = page.locator("#push-notifications");
      await expect(card).toHaveAttribute("data-push-state", "ready");
      await expectBelowHeader(card);
      await expect(card).toBeInViewport({ ratio: 1 });
      await expect(
        card.getByRole("heading", {
          name: labels[language].pushTitle,
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
      const enable = card.getByRole("button", {
        name: labels[language].enable,
        exact: true,
      });
      await expect(enable).toBeEnabled();
      await expect(enable).toBeInViewport({ ratio: 1 });
    });

    test("шаг ключа доступа открывает карточку ключей в профиле", async ({
      page,
      students,
    }) => {
      await readyPushBrowser(page);
      const firstSteps = await signIn(
        page,
        (await students.get("timur")).credentials,
        language,
      );
      const progress = await page.request.get("/api/me/onboarding");
      expect(progress.status()).toBe(200);
      const onboarding = await progress.json();
      test.skip(
        !onboarding.steps.some(
          (step: { code: string }) => step.code === "passkey",
        ),
        "Шаг ключа доступа требует сервер с WebAuthn origin по имени хоста.",
      );
      await firstSteps
        .locator('[data-onboarding-step="passkey"]')
        .getByRole("link")
        .click();
      await expect(page).toHaveURL(/\/profile#passkeys$/);
      const card = page.locator("#passkeys");
      const addKey = card.getByRole("button", {
        name: labels[language].addKey,
        exact: true,
      });
      await expect(addKey).toBeEnabled();
      await expect(page.locator("#push-notifications")).not.toHaveAttribute(
        "data-push-state",
        "loading",
      );
      await expectBelowHeader(card);
      await expect(
        card.getByRole("heading", {
          name: labels[language].passkeysTitle,
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        card.getByLabel(labels[language].deviceName, { exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(addKey).toBeInViewport({ ratio: 1 });
    });

    for (const [first, second] of [
      ["push", "passkeys"],
      ["passkeys", "push"],
    ] as const) {
      test(`медленная загрузка карточек: ${first === "push" ? "уведомления → ключи" : "ключи → уведомления"}`, async ({
        page,
        students,
      }) => {
        await readyPushBrowser(page);
        const gates = { push: responseGate(), passkeys: responseGate() };
        await page.route(
          (url) =>
            url.pathname === "/api/push" || url.pathname === "/api/passkeys",
          async (route) => {
            if (route.request().method() !== "GET") return route.continue();
            const name =
              new URL(route.request().url()).pathname === "/api/push"
                ? "push"
                : "passkeys";
            const response = await route.fetch();
            await gates[name].waiting;
            await route.fulfill({ response });
          },
        );
        try {
          const firstSteps = await signIn(
            page,
            (await students.get("timur")).credentials,
            language,
          );
          const progress = await page.request.get("/api/me/onboarding");
          expect(progress.status()).toBe(200);
          const onboarding = await progress.json();
          test.skip(
            !onboarding.steps.some(
              (step: { code: string }) => step.code === "passkey",
            ),
            "Шаг ключа доступа требует сервер с WebAuthn origin по имени хоста.",
          );
          await firstSteps
            .locator('[data-onboarding-step="passkey"]')
            .getByRole("link")
            .click();
          await expect(page).toHaveURL(/\/profile#passkeys$/);
          const card = page.locator("#passkeys");
          const cards = {
            push: page.locator("#push-notifications"),
            passkeys: card,
          };
          for (const item of Object.values(cards))
            await expect(item).toHaveAttribute(
              "data-profile-anchor-ready",
              "false",
            );
          gates[first].release();
          await expect(cards[first]).toHaveAttribute(
            "data-profile-anchor-ready",
            "true",
          );
          await expect(cards[second]).toHaveAttribute(
            "data-profile-anchor-ready",
            "false",
          );
          gates[second].release();
          await expect(cards[second]).toHaveAttribute(
            "data-profile-anchor-ready",
            "true",
          );
          const addKey = card.getByRole("button", {
            name: labels[language].addKey,
            exact: true,
          });
          await expect(addKey).toBeEnabled();
          await expectBelowHeader(card);
          await expect(
            card.getByRole("heading", {
              name: labels[language].passkeysTitle,
              exact: true,
            }),
          ).toBeInViewport({ ratio: 1 });
          await expect(
            card.getByLabel(labels[language].deviceName, { exact: true }),
          ).toBeInViewport({ ratio: 1 });
          await expect(addKey).toBeInViewport({ ratio: 1 });
        } finally {
          gates.push.release();
          gates.passkeys.release();
          await page.unrouteAll({ behavior: "wait" });
        }
      });
    }
  });
}
