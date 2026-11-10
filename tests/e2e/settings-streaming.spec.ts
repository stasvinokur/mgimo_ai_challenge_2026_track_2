import { createServer } from "node:http";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAs } from "../security/login";

const settingCookies = [
  "pulse-large-text",
  "pulse-high-contrast",
  "pulse-reduced-motion",
] as const;
const modes: {
  name: string;
  cookies: readonly (typeof settingCookies)[number][];
  language?: "en";
  savedTheme?: "light" | "dark";
  systemTheme?: "light" | "dark";
}[] = [
  { name: "без настроек", cookies: [] },
  { name: "крупный текст", cookies: [settingCookies[0]] },
  { name: "высокий контраст", cookies: [settingCookies[1]] },
  { name: "меньше движения", cookies: [settingCookies[2]] },
  { name: "все настройки", cookies: [...settingCookies] },
  { name: "English", cookies: [], language: "en" },
  {
    name: "English и все настройки",
    cookies: [...settingCookies],
    language: "en",
  },
  {
    name: "тёмная тема при светлой системе",
    cookies: [],
    savedTheme: "dark",
    systemTheme: "light",
  },
  {
    name: "светлая тема при тёмной системе",
    cookies: [],
    savedTheme: "light",
    systemTheme: "dark",
  },
  {
    name: "English, тёмная тема при светлой системе",
    cookies: [],
    language: "en",
    savedTheme: "dark",
    systemTheme: "light",
  },
  {
    name: "English, светлая тема при тёмной системе",
    cookies: [],
    language: "en",
    savedTheme: "light",
    systemTheme: "dark",
  },
];

async function openStreamingProxy(baseURL: string) {
  let authentication = "";
  let gate:
    | {
        path: string;
        shell: PromiseWithResolvers<void>;
        release: PromiseWithResolvers<void>;
      }
    | undefined;
  const failures: Error[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (
          value === undefined ||
          ["host", "connection", "cookie", "accept-encoding"].includes(name)
        )
          continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      headers.set("Cookie", authentication);
      headers.set("Accept-Encoding", "identity");
      const upstream = await fetch(new URL(request.url ?? "/", baseURL), {
        headers,
        redirect: "manual",
      });
      response.statusCode = upstream.status;
      upstream.headers.forEach((value, name) => {
        if (
          ![
            "content-encoding",
            "content-length",
            "transfer-encoding",
            "connection",
            "set-cookie",
          ].includes(name)
        )
          response.setHeader(name, value);
      });
      const hold =
        gate?.path === request.url &&
        request.headers.accept?.includes("text/html")
          ? gate
          : undefined;
      if (!hold) {
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      const html = await upstream.text();
      const split = html.search(/<div hidden(?:="")? id="S:/);
      if (split < 0) throw new Error("Ответ не содержит потокового сегмента.");
      const flight: string[] = [];
      const tail = html
        .slice(split)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (script) => {
          if (!script.includes("self.__next_f")) return script;
          flight.push(script);
          return "";
        });
      // Deliver Flight first so hydration starts while the HTML boundary is pending.
      response.write(html.slice(0, split) + flight.join(""));
      response.flushHeaders();
      hold.shell.resolve();
      await hold.release.promise;
      response.end(tail);
    })().catch((error: unknown) => {
      const failure =
        error instanceof Error ? error : new Error("Ошибка потокового прокси.");
      failures.push(failure);
      gate?.shell.resolve();
      if (!response.headersSent) response.statusCode = 502;
      response.end("STREAMING_PROXY_FAILED");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Не удалось открыть потоковый прокси.");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    authenticate(cookie: string) {
      authentication = cookie;
    },
    hold(path: string) {
      gate = {
        path,
        shell: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      return gate;
    },
    async close() {
      gate?.release.resolve();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      expect(failures, "Потоковый прокси завершился без ошибок").toEqual([]);
    },
  };
}

async function expectNoStreamCopies(page: Page) {
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
}

for (const mode of modes) {
  test(`потоковая гидратация: ${mode.name}, страницы не дублируются`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    const expectedTheme = mode.savedTheme ?? mode.systemTheme ?? "light";
    await page.emulateMedia({ colorScheme: mode.systemTheme ?? "light" });
    await page.addInitScript((theme) => {
      localStorage.setItem("pulse-theme", theme);
      const marker = window as Window & { settingsRootEffect?: boolean };
      marker.settingsRootEffect = false;
      const target: EventTarget = window;
      const listen = target.addEventListener;
      target.addEventListener = (type, listener, options) => {
        if (type === "beforeinstallprompt") marker.settingsRootEffect = true;
        listen.call(target, type, listener, options);
      };
    }, mode.savedTheme ?? "system");
    const proxy = await openStreamingProxy(baseURL);
    async function authenticate(account: "anna" | "marina") {
      await loginAs(page, account);
      const cookies = await context.cookies(baseURL);
      proxy.authenticate(
        [
          ...cookies
            .filter(
              (cookie) => !settingCookies.some((name) => name === cookie.name),
            )
            .map((cookie) => `${cookie.name}=${cookie.value}`),
          ...settingCookies.map(
            (name) => `${name}=${mode.cookies.includes(name) ? "on" : "off"}`,
          ),
          ...(mode.language ? [`pulse-language=${mode.language}`] : []),
        ].join("; "),
      );
    }
    async function navigate(path: string, title: string, key: Locator) {
      const pending = proxy.hold(path);
      try {
        const response = await page.goto(proxy.origin + path, {
          waitUntil: "commit",
        });
        expect(response?.status()).toBe(200);
        await pending.shell.promise;
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          mode.language ?? "ru",
        );
        await expect(page.locator("html")).toHaveClass(
          new RegExp(`\\b${expectedTheme}\\b`),
        );
        await expect(page.locator("html")).toHaveCSS(
          "color-scheme",
          expectedTheme,
        );
        for (const cookie of settingCookies) {
          const className = new RegExp(`a11y-${cookie.slice("pulse-".length)}`);
          if (mode.cookies.includes(cookie))
            await expect(page.locator("html")).toHaveClass(className);
          else await expect(page.locator("html")).not.toHaveClass(className);
        }
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as Window & { settingsRootEffect?: boolean })
                  .settingsRootEffect === true,
            ),
          )
          .toBe(true);
        // Let mount effects and their updates commit before releasing the segment.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await expect(
          key,
          "До выдачи сегмента клиент не создаёт копию страницы",
        ).toHaveCount(0);
      } finally {
        pending.release.resolve();
      }
      await expect(
        page.getByRole("heading", { level: 1, name: title, exact: true }),
      ).toBeVisible();
      // Loading is awaited only after hydration has started with the tail withheld.
      await page.waitForLoadState("load");
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${expectedTheme}\\b`),
      );
      await expect(page.locator("html")).toHaveCSS(
        "color-scheme",
        expectedTheme,
      );
      await expectNoStreamCopies(page);
    }
    try {
      await authenticate("anna");
      await navigate(
        "/today",
        mode.language === "en" ? "Today" : "Сегодня",
        page.getByTestId("today-change"),
      );
      await expect(
        page.getByTestId("today-change").filter({
          hasText: mode.language === "en" ? "Rescheduled" : "Перенос",
        }),
      ).toHaveCount(1);

      await navigate(
        "/grades",
        mode.language === "en" ? "Study" : "Учёба",
        page.getByTestId("scholarship-forecast"),
      );
      await expect(page.getByTestId("scholarship-forecast")).toHaveCount(1);
      await page
        .getByRole("link", {
          name:
            mode.language === "en"
              ? "Open course «Иностранный язык»"
              : "Открыть дисциплину «Иностранный язык»",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Иностранный язык",
          exact: true,
        }),
      ).toBeVisible();
      await expectNoStreamCopies(page);
      await expect(page.getByTestId("scholarship-forecast")).toHaveCount(1);

      const requestRecipient = page.getByLabel(
        mode.language === "en"
          ? "Recipient (required)"
          : "Место требования (обязательно)",
      );
      await navigate(
        "/requests/new?type=enrollment",
        mode.language === "en" ? "New request" : "Новая заявка",
        requestRecipient,
      );
      await expect(requestRecipient).toHaveCount(1);

      await authenticate("marina");
      await navigate(
        "/staff/requests",
        "Заявки студентов",
        page.locator("[data-request-id]"),
      );
      const firstCard = page.locator("[data-request-id]").first();
      await expect(firstCard).toBeVisible();
      const id = await firstCard.getAttribute("data-request-id");
      expect(id).toBeTruthy();
      await expect(page.locator(`[data-request-id="${id}"]`)).toHaveCount(1);
    } finally {
      await proxy.close();
    }
  });
}
