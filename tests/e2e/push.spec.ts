import type { Page } from "@playwright/test";
import { appPath } from "@/ui/shared/app-path.mjs";
import { expect, test } from "../security/student-login";

const endpoint = "https://fcm.googleapis.com/fcm/send/push-ui-fixture";
const publicKey = "B".repeat(87);

async function fakePush(
  page: Page,
  settings: {
    permission?: NotificationPermission;
    existing?: boolean;
    supported?: boolean;
    iphone?: boolean;
    renewalEndpoint?: string;
    unsubscribeResult?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ endpoint, settings, scopePath, workerPath }) => {
      const state = { permissionRequests: 0, subscriptions: 0, removals: 0 };
      Object.defineProperty(window, "__pushTest", { value: state });
      const responses: Response[] = [];
      Object.defineProperty(state, "responseBodiesRead", {
        enumerable: true,
        get: () => responses.every((response) => response.bodyUsed),
      });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await originalFetch(...args);
        const input = args[0];
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (new URL(url, location.origin).pathname.startsWith("/api/push"))
          responses.push(response);
        return response;
      };
      let current: PushSubscription | null = null;
      function subscription(address = endpoint): PushSubscription {
        return {
          endpoint: address,
          expirationTime: null,
          options: {} as PushSubscriptionOptions,
          getKey: () => null,
          toJSON: () => ({
            endpoint: address,
            expirationTime: null,
            keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
          }),
          async unsubscribe() {
            state.removals += 1;
            current = null;
            return settings.unsubscribeResult ?? true;
          },
        };
      }
      if (settings.existing) current = subscription();
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
      const registration = new EventTarget();
      Object.assign(registration, {
        scope,
        active,
        pushManager: {
          getSubscription: async () => current,
          async subscribe() {
            state.subscriptions += 1;
            current = subscription(settings.renewalEndpoint);
            return current;
          },
        },
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: Object.assign(new EventTarget(), {
          ready: Promise.resolve(registration),
          getRegistration: async (clientURL = location.href) =>
            new URL(clientURL, location.href).href.startsWith(scope)
              ? registration
              : undefined,
          getRegistrations: async () => [registration],
          controller: active,
          register: async () => registration,
        }),
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: settings.supported === false ? undefined : class {},
      });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: settings.permission ?? "default",
          async requestPermission() {
            state.permissionRequests += 1;
            return settings.permission === "denied" ? "denied" : "granted";
          },
        },
      });
      if (settings.iphone) {
        Object.defineProperty(navigator, "userAgent", { value: "iPhone" });
        Object.defineProperty(navigator, "standalone", { value: false });
        const originalMatch = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = originalMatch(query);
          if (query === "(display-mode: standalone)")
            Object.defineProperty(result, "matches", { value: false });
          return result;
        };
      }
    },
    {
      endpoint,
      settings,
      scopePath: appPath("/"),
      workerPath: appPath("/sw.js"),
    },
  );
}

async function fakeApi(
  page: Page,
  options: {
    publicKey?: string | null;
    existing?: boolean;
    failFirst?: boolean;
    failMutationPath?: string;
    testFailure?: "gone" | "transient";
    staleDelete?: boolean;
  } = {},
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let subscribed = options.existing ?? false;
  let loads = 0;
  let failedTest = false;
  await page.route("**/api/push**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === "GET") {
      loads += 1;
      if (options.failFirst && loads === 1) {
        await route.fulfill({ status: 503, json: { error: "Недоступно" } });
        return;
      }
      await route.fulfill({
        json: {
          publicKey:
            options.publicKey === undefined ? publicKey : options.publicKey,
          endpoints: subscribed ? [endpoint] : [],
        },
      });
      return;
    }
    calls.push({ method, path, body: request.postDataJSON() });
    if (path === "/api/push/test" && options.testFailure && !failedTest) {
      failedTest = true;
      if (options.testFailure === "gone") subscribed = false;
      await route.fulfill({
        status: 400,
        json: { error: "Проверка недоступна" },
      });
      return;
    }
    if (method === "DELETE" && options.staleDelete) {
      subscribed = false;
      await route.fulfill({
        status: 404,
        json: { error: "Подписка не найдена" },
      });
      return;
    }
    if (path === options.failMutationPath) {
      await route.fulfill({ status: 503, json: { error: "Недоступно" } });
      return;
    }
    if (path === "/api/push/subscription") subscribed = method === "POST";
    await route.fulfill({ json: { ok: true } });
  });
  return calls;
}

function card(page: Page) {
  return page.locator("[data-push-state]");
}

async function browserState(page: Page) {
  return page.evaluate(
    () =>
      Reflect.get(window, "__pushTest") as {
        permissionRequests: number;
        subscriptions: number;
        removals: number;
        responseBodiesRead: boolean;
      },
  );
}

test("push: включение только по нажатию, проверка и выключение на устройстве", async ({
  page,
  loginAs,
}) => {
  await fakePush(page);
  const calls = await fakeApi(page);
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  expect((await browserState(page)).permissionRequests).toBe(0);
  await card(page)
    .getByRole("button", { name: "Включить", exact: true })
    .click();
  await expect(card(page)).toContainText("Включены на этом устройстве.");
  expect(await browserState(page)).toMatchObject({
    permissionRequests: 1,
    subscriptions: 1,
  });
  expect(calls[0]).toMatchObject({
    method: "POST",
    path: "/api/push/subscription",
    body: { endpoint, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } },
  });
  await card(page)
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await expect(card(page).getByRole("status")).toContainText(
    "Тестовое уведомление отправлено.",
  );
  expect(calls[1]).toEqual({
    method: "POST",
    path: "/api/push/test",
    body: { endpoint },
  });
  for (const button of await card(page).getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card(page)
    .getByRole("button", { name: "Выключить", exact: true })
    .click();
  await expect(card(page)).toContainText("Выключены на этом устройстве.");
  await expect(
    card(page).getByRole("button", { name: "Включить", exact: true }),
  ).toBeEnabled();
  expect(calls[2]).toEqual({
    method: "DELETE",
    path: "/api/push/subscription",
    body: { endpoint },
  });
  expect(await browserState(page)).toMatchObject({
    removals: 1,
    responseBodiesRead: true,
  });
});

test("push: браузер без поддержки получает пояснение вместо включения", async ({
  page,
  loginAs,
}) => {
  await fakePush(page, { supported: false });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toContainText(
    "Этот браузер не поддерживает уведомления на телефон.",
  );
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect((await browserState(page)).permissionRequests).toBe(0);
});

test("push: без серверных ключей доступна лента и нет кнопки включения", async ({
  page,
  loginAs,
}) => {
  await fakePush(page);
  await fakeApi(page, { publicKey: null });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toContainText(
    "Уведомления на телефон пока не настроены на сервере.",
  );
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect((await browserState(page)).permissionRequests).toBe(0);
});

test("push: на iPhone объясняет установку на экран «Домой»", async ({
  page,
  loginAs,
}) => {
  await fakePush(page, { iphone: true });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toContainText("добавьте «Пульс» на экран «Домой»");
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect((await browserState(page)).permissionRequests).toBe(0);
});

test("push: запрет браузера объясняет настройки без повторного запроса разрешения", async ({
  page,
  loginAs,
}) => {
  await fakePush(page, { permission: "denied" });
  await fakeApi(page);
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toContainText(
    "Уведомления запрещены в настройках браузера.",
  );
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect((await browserState(page)).permissionRequests).toBe(0);
});

test("push: ошибка загрузки повторяется без перезагрузки профиля", async ({
  page,
  loginAs,
}) => {
  await fakePush(page);
  await fakeApi(page, { failFirst: true });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page).getByRole("alert")).toBeVisible();
  await card(page)
    .getByRole("button", { name: "Повторить", exact: true })
    .click();
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  await expect(
    card(page).getByRole("button", { name: "Включить", exact: true }),
  ).toBeEnabled();
});

test("push: локальная подписка другого пользователя обновляется только по нажатию", async ({
  page,
  loginAs,
}) => {
  const renewed = `${endpoint}-renewed`;
  await fakePush(page, { existing: true, renewalEndpoint: renewed });
  const calls = await fakeApi(page);
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  await expect(card(page)).toContainText("Выключены на этом устройстве.");
  expect(calls).toEqual([]);
  expect((await browserState(page)).permissionRequests).toBe(0);
  expect((await browserState(page)).removals).toBe(0);
  await card(page)
    .getByRole("button", { name: "Включить", exact: true })
    .click();
  await expect(card(page)).toContainText("Включены на этом устройстве.");
  await expect(card(page).getByRole("status")).toContainText(
    "Уведомления включены на этом устройстве.",
  );
  expect(calls).toEqual([
    {
      method: "POST",
      path: "/api/push/subscription",
      body: {
        endpoint: renewed,
        expirationTime: null,
        keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
      },
    },
  ]);
  expect(await browserState(page)).toMatchObject({
    permissionRequests: 1,
    subscriptions: 1,
    removals: 1,
    responseBodiesRead: true,
  });
});

test("push: своя существующая подписка доступна без создания новой", async ({
  page,
  loginAs,
}) => {
  await fakePush(page, { existing: true, permission: "granted" });
  const calls = await fakeApi(page, { existing: true });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  await expect(card(page)).toContainText("Включены на этом устройстве.");
  await card(page)
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await expect(card(page).getByRole("status")).toContainText(
    "Тестовое уведомление отправлено.",
  );
  expect(calls).toEqual([
    { method: "POST", path: "/api/push/test", body: { endpoint } },
  ]);
  expect(await browserState(page)).toMatchObject({
    permissionRequests: 0,
    subscriptions: 0,
    removals: 0,
    responseBodiesRead: true,
  });
});

test("push: ошибка сохранения отменяет новую подписку и дочитывает ответ", async ({
  page,
  loginAs,
}) => {
  await fakePush(page);
  await fakeApi(page, { failMutationPath: "/api/push/subscription" });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  await card(page)
    .getByRole("button", { name: "Включить", exact: true })
    .click();
  await expect(card(page).getByRole("alert")).toContainText(
    "Не удалось сохранить настройку.",
  );
  await expect(card(page)).toContainText("Выключены на этом устройстве.");
  expect(await browserState(page)).toMatchObject({
    subscriptions: 1,
    removals: 1,
    responseBodiesRead: true,
  });
});

test("push: исчезнувшую подписку можно включить заново после ошибки проверки", async ({
  page,
  loginAs,
}) => {
  const renewed = `${endpoint}-renewed`;
  await fakePush(page, {
    existing: true,
    permission: "granted",
    renewalEndpoint: renewed,
    unsubscribeResult: false,
  });
  const calls = await fakeApi(page, { existing: true, testFailure: "gone" });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  await card(page)
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await expect(
    card(page).getByRole("button", { name: "Включить", exact: true }),
  ).toBeEnabled();
  await expect(card(page).getByRole("alert")).toContainText(
    "Не удалось доставить проверку.",
  );
  await expect(card(page)).toContainText("Выключены на этом устройстве.");
  await card(page)
    .getByRole("button", { name: "Включить", exact: true })
    .click();
  await expect(card(page)).toContainText("Включены на этом устройстве.");
  expect(calls.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: "POST", path: "/api/push/test" },
    { method: "POST", path: "/api/push/subscription" },
  ]);
  expect(calls[1]?.body).toMatchObject({ endpoint: renewed });
  expect(await browserState(page)).toMatchObject({
    subscriptions: 1,
    removals: 1,
    responseBodiesRead: true,
  });
});

test("push: временный сбой проверки сохраняет действующую подписку", async ({
  page,
  loginAs,
}) => {
  await fakePush(page, { existing: true, permission: "granted" });
  const calls = await fakeApi(page, {
    existing: true,
    testFailure: "transient",
  });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  const recovered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/push" &&
      response.request().method() === "GET",
  );
  await card(page)
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await recovered;
  await expect(card(page).getByRole("alert")).toContainText(
    "Не удалось доставить проверку.",
  );
  await expect(
    card(page).getByRole("button", { name: "Проверить", exact: true }),
  ).toBeEnabled();
  await expect(card(page)).toContainText("Включены на этом устройстве.");
  await card(page)
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await expect(card(page).getByRole("status")).toContainText(
    "Тестовое уведомление отправлено.",
  );
  expect(calls).toHaveLength(2);
  expect(await browserState(page)).toMatchObject({
    permissionRequests: 0,
    subscriptions: 0,
    removals: 0,
    responseBodiesRead: true,
  });
});

test("push: выключение очищает браузерную подписку после удаления в другой вкладке", async ({
  page,
  loginAs,
}) => {
  await fakePush(page, { existing: true, permission: "granted" });
  await fakeApi(page, { existing: true, staleDelete: true });
  await loginAs("anna");
  await page.goto("/profile");
  await expect(card(page)).toHaveAttribute("data-push-state", "ready");
  await card(page)
    .getByRole("button", { name: "Выключить", exact: true })
    .click();
  await expect(
    card(page).getByRole("button", { name: "Включить", exact: true }),
  ).toBeEnabled();
  await expect(card(page).getByRole("status")).toContainText(
    "Уведомления выключены на этом устройстве.",
  );
  await expect(card(page).getByRole("alert")).toHaveCount(0);
  expect(await browserState(page)).toMatchObject({
    removals: 1,
    responseBodiesRead: true,
  });
});
