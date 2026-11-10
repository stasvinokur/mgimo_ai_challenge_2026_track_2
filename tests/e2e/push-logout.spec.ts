import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createDatabase } from "@/infrastructure/db/client";
import { appPath } from "@/ui/shared/app-path.mjs";
import { expect, test } from "../security/student-login";

async function fakePushForLogout(
  page: Page,
  endpoint: string,
  failUnsubscribe = false,
) {
  const removals: { bodiesRead: boolean }[] = [];
  await page.exposeFunction(
    "pushLogoutObserved",
    (value: { bodiesRead: boolean }) => {
      removals.push(value);
    },
  );
  await page.addInitScript(
    ({ endpoint, failUnsubscribe, scopePath, workerPath }) => {
      const removedKey = `push-logout-test:${endpoint}`;
      let subscribed = sessionStorage.getItem(removedKey) !== "removed";
      const observe = Reflect.get(window, "pushLogoutObserved");
      const responses: Response[] = [];
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
        if (new URL(url, location.origin).pathname === "/api/push/subscription")
          responses.push(response);
        return response;
      };
      const subscription = {
        endpoint,
        async unsubscribe() {
          await observe({
            bodiesRead: responses.every((response) => response.bodyUsed),
          });
          if (failUnsubscribe) throw new Error("PUSH_TEST_UNSUBSCRIBE_FAILED");
          subscribed = false;
          sessionStorage.setItem(removedKey, "removed");
          return true;
        },
      };
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
        pushManager: {
          getSubscription: async () => (subscribed ? subscription : null),
        },
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
        value: { permission: "granted" },
      });
    },
    {
      endpoint,
      failUnsubscribe,
      scopePath: appPath("/"),
      workerPath: appPath("/sw.js"),
    },
  );
  return removals;
}

async function profileReady(page: Page) {
  await page.goto("/profile");
  await expect(page.locator("[data-push-state]")).not.toHaveAttribute(
    "data-push-state",
    "loading",
  );
}

test("push: выход удаляет подписку из БД и отписывает общий браузер", async ({
  page,
  students,
  loginAs,
}) => {
  const own = await students.get("anna");
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const removals = await fakePushForLogout(page, endpoint);
  const sql = createDatabase(1);
  try {
    await sql`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${randomUUID()}, ${own.actor.userId}, ${endpoint}, ${`B${"a".repeat(86)}`}, ${"a".repeat(22)})`;
    await loginAs("anna");
    await profileReady(page);
    expect(removals).toEqual([]);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(removals).toEqual([{ bodiesRead: true }]);
    expect(
      await sql`select id from push_subscriptions where endpoint = ${endpoint}`,
    ).toHaveLength(0);
    await loginAs("timur");
    expect(
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return await registration?.pushManager.getSubscription();
      }),
    ).toBeNull();
    expect(
      await sql`select id from push_subscriptions where endpoint = ${endpoint}`,
    ).toHaveLength(0);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("push: ошибка удаления подписки не мешает выходу и отписке браузера", async ({
  page,
  loginAs,
}) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const removals = await fakePushForLogout(page, endpoint);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.route("**/api/push/subscription", async (route) => {
    await route.fulfill({ status: 500, json: { error: "Недоступно" } });
  });
  await loginAs("anna");
  await profileReady(page);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(removals).toEqual([{ bodiesRead: true }]);
  expect(warnings).toContain("PUSH_LOGOUT_DELETE_FAILED");
});

test("push: ошибка отписки браузера не мешает выходу", async ({
  page,
  loginAs,
}) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const removals = await fakePushForLogout(page, endpoint, true);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await loginAs("anna");
  await profileReady(page);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(removals).toEqual([{ bodiesRead: true }]);
  expect(warnings).toContain("PUSH_LOGOUT_UNSUBSCRIBE_FAILED");
});
