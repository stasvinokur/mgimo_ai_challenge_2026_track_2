import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { appPath } from "@/ui/shared/app-path.mjs";
import { expect, loginAs, test } from "../security/login";

const key = {
  id: "profile-en-key",
  deviceName: "Учебный телефон",
  createdAt: "2026-11-05T10:00:00.000Z",
  lastUsedAt: null,
};

async function mockPhoneNotifications(page: Page) {
  await page.addInitScript(
    ({ scopePath, workerPath }) => {
      let current: PushSubscription | null = null;
      const subscription = {
        endpoint: "https://push.example.invalid/profile-en",
        toJSON: () => ({ endpoint: "https://push.example.invalid/profile-en" }),
        async unsubscribe() {
          current = null;
          return true;
        },
      } as PushSubscription;
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
          getSubscription: async () => current,
          async subscribe() {
            current = subscription;
            return subscription;
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
        value: class {},
      });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: "default",
          requestPermission: async () => "granted",
        },
      });
    },
    { scopePath: appPath("/"), workerPath: appPath("/sw.js") },
  );
  await page.route("**/api/push**", (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? { publicKey: "B".repeat(87), endpoints: [] }
          : { ok: true },
    }),
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`English: профиль, ключи доступа и push · ${theme}`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await mockPhoneNotifications(page);
    let failLoad = true;
    await page.route("**/api/passkeys", (route) => {
      if (failLoad) {
        failLoad = false;
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      }
      return route.fulfill({ json: { credentials: [key] } });
    });
    await page.route("**/api/passkeys/registration/options", (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: {
            code: "PASSKEY_LIMIT_REACHED",
            message: "Не показывать готовую фразу сервера",
          },
        },
      }),
    );
    await loginAs(page, "anna");
    await context.addCookies([
      { name: "pulse-language", value: "en", url: baseURL },
    ]);
    await page.goto("/profile");
    const main = page.getByRole("main");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      main.getByRole("heading", { name: "Profile", exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: "Student details" }),
    ).toBeVisible();
    await expect(main).toContainText("Анна Соколова");
    await expect(main).toContainText("Full name");
    await expect(main).toContainText("Programme");
    await expect(main).toContainText("Scholarship");
    await expect(
      main.getByRole("link", { name: "My assistant journal" }),
    ).toHaveAttribute("href", "/profile/assistant");
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await expect(settings).toHaveAttribute("data-settings-ready", "true");
    await expect(settings.getByLabel("Language", { exact: true })).toHaveValue(
      "en",
    );

    const passkeys = page.getByRole("region", {
      name: "Passkeys",
      exact: true,
    });
    await expect(passkeys.getByRole("alert")).toContainText(
      "Could not load passkeys.",
    );
    await passkeys
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await expect(
      passkeys.getByText(key.deviceName, { exact: true }),
    ).toBeVisible();
    await expect(passkeys).toContainText("Not used yet");
    await expect(passkeys.locator("time")).toHaveText(
      `${new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Moscow",
      }).format(new Date(key.createdAt))} MSK`,
    );
    await passkeys
      .getByLabel("Device name", { exact: true })
      .fill("Demo phone");
    const add = passkeys.getByRole("button", {
      name: "Add passkey",
      exact: true,
    });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(passkeys.getByRole("alert")).toHaveText(
      "You can add up to 10 passkeys. Remove an unused passkey and try again.",
    );

    const push = page.locator("[data-push-state]");
    await expect(push).toHaveAttribute("data-push-state", "ready");
    await expect(
      push.getByRole("heading", { name: "Phone notifications" }),
    ).toBeVisible();
    await push.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(push.getByRole("status")).toHaveText(
      "Notifications are enabled on this device.",
    );
    await push.getByRole("button", { name: "Test", exact: true }).click();
    await expect(push.getByRole("status")).toContainText(
      "Test notification sent.",
    );
    await push.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(push.getByRole("status")).toHaveText(
      "Notifications are disabled on this device.",
    );
    await expect(push).toContainText("Disabled on this device.");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await main.getByRole("button").all()) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(await button.getAttribute("aria-label")).toBeNull();
    }
    const wrapping = await main
      .getByRole("heading", { name: "Student details" })
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.overflowWrap, style.wordBreak];
      });
    expect(wrapping).toEqual(["normal", "normal"]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await info.attach(`profile-en-${theme}`, {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png",
    });
  });
}
