import type { Page, TestInfo } from "@playwright/test";
import { CryptoSessionTokens } from "../../src/infrastructure/auth/session-tokens";
import { createDatabase } from "../../src/infrastructure/db/client";
import { PostgresSessionStore } from "../../src/infrastructure/db/repositories/identity/sessions";
import { UuidV7Generator } from "../../src/infrastructure/system/id-generator";
import {
  PAGE_CACHE_PREFIX,
  SESSION_EXPIRES_HEADER,
  SESSION_STATE_CACHE,
} from "../../src/ui/shell/pwa-cache";
import { expect, test } from "../security/student-login";
import { precacheURLs } from "./pwa-precache";
import { capturePwaScreenshot as capture } from "./screenshot";

test.use({ serviceWorkers: "allow" });

async function controlled(page: Page) {
  await expect
    .poll(
      () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      { timeout: 15_000 },
    )
    .toBe(true);
}
async function pageCacheURLs(page: Page) {
  return page.evaluate(async (prefix) => {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith(prefix),
    );
    return (
      await Promise.all(
        names.map(async (name) =>
          (
            await (await caches.open(name)).keys()
          ).map((request) => new URL(request.url).pathname),
        ),
      )
    )
      .flat()
      .sort();
  }, PAGE_CACHE_PREFIX);
}
async function waitSnapshot(page: Page, pathname: string) {
  await expect
    .poll(() => pageCacheURLs(page), { timeout: 20_000 })
    .toContain(pathname);
}
async function waitWarmFetch(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          performance.getEntriesByType("resource").some((entry) => {
            const resource = entry as PerformanceResourceTiming;
            const url = new URL(resource.name);
            return (
              resource.initiatorType === "fetch" &&
              url.origin === location.origin &&
              url.pathname === "/today" &&
              !url.search &&
              resource.workerStart > 0 &&
              resource.responseEnd > 0
            );
          }),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}
async function markDocument(page: Page, marker: string) {
  await page.evaluate((marker) => {
    Reflect.set(window, "pwaOnlineMarker", marker);
    const navigation = Reflect.get(window, "navigation") as EventTarget;
    // Detect the reload intent before it can replace the document.
    navigation.addEventListener(
      "navigate",
      () => Reflect.deleteProperty(window, "pwaOnlineMarker"),
      { once: true },
    );
  }, marker);
}

async function recordConnectivity(page: Page) {
  await page.addInitScript(() => {
    function record(event: string, details = {}) {
      const key = "pwa-connectivity-events";
      const events = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      events.push({
        event,
        at: Date.now(),
        documentAt: performance.timeOrigin,
        path: location.pathname,
        online: navigator.onLine,
        visible: document.visibilityState,
        snapshot: Boolean(document.documentElement?.dataset.pwaSavedAt),
        reason: document.documentElement?.dataset.pwaSnapshotReason,
        controlled: Boolean(navigator.serviceWorker.controller),
        ...details,
      });
      sessionStorage.setItem(key, JSON.stringify(events.slice(-200)));
    }
    for (const name of [
      "online",
      "offline",
      "beforeunload",
      "pagehide",
      "pageshow",
      "load",
    ])
      window.addEventListener(name, () => record(name));
    for (const name of ["DOMContentLoaded", "visibilitychange"])
      document.addEventListener(name, () => record(name));
    const navigation = Reflect.get(window, "navigation") as EventTarget;
    navigation.addEventListener("navigate", () => record("navigate"));
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        const url = new URL(entry.name);
        if (
          url.origin !== location.origin ||
          !["/today", "/schedule", "/api/me/pulse"].includes(url.pathname)
        )
          continue;
        record("response", {
          path: url.pathname,
          kind: entry.entryType,
          status: entry.responseStatus,
          workerStart: entry.workerStart,
          responseEnd: entry.responseEnd,
        });
      }
    });
    observer.observe({ entryTypes: ["navigation", "resource"] });
    record("init");
  });
}

async function attachConnectivity(page: Page, info: TestInfo) {
  const journal = await page.evaluate(() => ({
    events: JSON.parse(
      sessionStorage.getItem("pwa-connectivity-events") ?? "[]",
    ),
    final: {
      online: navigator.onLine,
      visible: document.visibilityState,
      snapshot: Boolean(document.documentElement.dataset.pwaSavedAt),
      reason: document.documentElement.dataset.pwaSnapshotReason,
    },
  }));
  await info.attach("pwa-connectivity", {
    body: JSON.stringify(journal, null, 2),
    contentType: "application/json",
  });
}

test("manifest, иконки и заголовки service worker", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Пульс — цифровой деканат",
    short_name: "Пульс",
    start_url: "/today",
    display: "standalone",
    theme_color: "#f5f6f2",
    background_color: "#f5f6f2",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      }),
    ]),
  );
  for (const icon of [
    ...manifest.icons,
    { src: "/icons/apple-touch-icon.png" },
  ]) {
    const png = await request.get(icon.src);
    expect(png.status()).toBe(200);
    expect((await png.body()).subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
    if ("sizes" in icon) {
      const bytes = await png.body();
      expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(
        icon.sizes,
      );
    }
  }
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toMatch(/no-cache|no-store/);
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
  expect(worker.headers()["content-security-policy"]).toBe(
    "default-src 'self'; script-src 'self'; object-src 'none'",
  );
  const login = await request.get("/login");
  const csp = login.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain("manifest-src 'self'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(await login.text()).toContain('rel="manifest"');
});

test("HTTP: каждый URL precache из production sw.js отвечает 200", async ({
  request,
}) => {
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  const urls = precacheURLs(await worker.text());
  expect(urls).toContain("/offline.html");
  expect(urls).not.toContain("/offline");
  for (const url of urls) {
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status(), `Precache ${url}`).toBe(200);
  }
});

test("HTTP: кэш разрешён только для HTML студента без продления cookie", async ({
  baseURL,
  students,
}) => {
  const student = await students.get("anna");
  const sql = createDatabase(1);
  const sessions = new PostgresSessionStore(() => sql);
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const id = new UuidV7Generator().next();
  async function get(path: string, headers: Record<string, string> = {}) {
    return fetch(new URL(path, baseURL), {
      redirect: "manual",
      headers: {
        Cookie: `__Host-pulse-session=${token}`,
        Origin: new URL(baseURL ?? "").origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        ...headers,
      },
    });
  }
  try {
    const now = new Date();
    await sessions.create({
      id,
      userId: student.actor.userId,
      tokenHash: tokens.hash(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    });
    for (const path of ["/today", "/schedule"]) {
      const response = await get(path, { Accept: "text/html" });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Pulse-Cacheable")).toBe("1");
      expect(
        /^[a-f0-9]{64}$/.test(response.headers.get("X-Pulse-Session") ?? ""),
      ).toBe(true);
      expect(
        response.headers.get("X-Pulse-Session") === tokens.hash(token),
      ).toBe(false);
      expect(response.headers.get(SESSION_EXPIRES_HEADER)).toBe(
        new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      );
      expect(response.headers.has("Set-Cookie")).toBe(false);
      const nonce = response.headers
        .get("Content-Security-Policy")
        ?.match(/'nonce-([^']+)'/)?.[1];
      expect(
        Boolean(nonce) && (await response.text()).includes(`nonce="${nonce}"`),
      ).toBe(true);
      let flight = await get(path, { RSC: "1", Accept: "text/x-component" });
      if (flight.status === 307)
        flight = await get(
          new URL(flight.headers.get("location") ?? "", baseURL).href,
          { RSC: "1", Accept: "text/x-component" },
        );
      expect(flight.headers.has("X-Pulse-Cacheable")).toBe(false);
    }
    const api = await get("/api/me/pulse");
    expect(api.status).toBe(200);
    expect(api.headers.has("X-Pulse-Cacheable")).toBe(false);
    const staff = await get("/staff/requests");
    expect(staff.status).toBe(403);
    expect(staff.headers.has("X-Pulse-Cacheable")).toBe(false);
    await sql`update sessions set last_seen_at = now() - interval '16 minutes' where id = ${id}`;
    const renewed = await get("/today", { Accept: "text/html" });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.has("Set-Cookie")).toBe(true);
    expect(renewed.headers.has("X-Pulse-Cacheable")).toBe(false);
  } finally {
    await sessions.revoke(id);
    await sql.end({ timeout: 1 });
  }
});

test("прогревающий fetch Сегодня под SW полностью завершается", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await controlled(page);
  // A fresh document has no timing entries from before the SW took control.
  await page.reload();
  await controlled(page);
  await waitWarmFetch(page);
  await waitSnapshot(page, "/today");
});

test("новый SW активируется при открытой Сегодня и удаляет копии чужой сборки", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await controlled(page);
  await waitSnapshot(page, "/today");
  await page.goto("/schedule");
  await waitSnapshot(page, "/schedule");
  await page.goto("/today");
  await waitSnapshot(page, "/today");
  await waitWarmFetch(page);
  const obsoleteCache = await page.evaluate(async (prefix) => {
    const current = (await caches.keys()).find((name) =>
      name.startsWith(prefix),
    );
    if (!current) throw new Error("Нет сохранённых страниц для обновления.");
    const fingerprint = current.slice(-64);
    const obsolete = `${prefix}e2e-obsolete-build-${fingerprint}`;
    const source = await caches.open(current);
    const target = await caches.open(obsolete);
    for (const path of ["/today", "/schedule"]) {
      const response = await source.match(path);
      if (!response) throw new Error("Нет копии экрана для обновления.");
      await target.put(path, response);
    }
    return obsolete;
  }, PAGE_CACHE_PREFIX);
  expect(await pageCacheURLs(page)).toEqual([
    "/schedule",
    "/schedule",
    "/today",
    "/today",
  ]);
  // A different script URL installs a new worker without routing SW update requests.
  // The artifact is unchanged; the foreign build's snapshots are seeded above.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?pwa-update=m3-7", {
      scope: "/",
      updateViaCache: "none",
      type: "module",
    });
  });
  await expect
    .poll(
      () =>
        page.evaluate(async (obsolete) => {
          const registration = await navigator.serviceWorker.getRegistration();
          const controller = navigator.serviceWorker.controller;
          return (
            controller?.scriptURL.endsWith("/sw.js?pwa-update=m3-7") === true &&
            registration?.active === controller &&
            controller.state === "activated" &&
            !registration.waiting &&
            !(await caches.keys()).includes(obsolete)
          );
        }, obsoleteCache),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(page).toHaveURL(/\/today$/);
  await waitWarmFetch(page);
  expect(await pageCacheURLs(page)).toEqual(["/schedule", "/today"]);
  expect(
    await page.evaluate((name) => caches.has(name), SESSION_STATE_CACHE),
  ).toBe(true);
});

test("истёкшая сессия не выдаёт персональные копии без сети", async ({
  page,
  context,
  loginAs,
  students,
}) => {
  await loginAs("anna");
  await controlled(page);
  await waitSnapshot(page, "/today");
  const student = await students.get("anna");
  const sql = createDatabase(1);
  const expiresAt = new Date(Date.now() + 10_000).toISOString();
  try {
    await sql`update sessions set expires_at = ${new Date(expiresAt)}, last_seen_at = now() where user_id = ${student.actor.userId}`;
    await page.evaluate(async () => {
      const response = await fetch("/today", {
        headers: { Accept: "text/html" },
        cache: "no-store",
      });
      await response.text();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async ({ prefix, header }) => {
            const name = (await caches.keys()).find((name) =>
              name.startsWith(prefix),
            );
            return name
              ? (await (await caches.open(name)).match("/today"))?.headers.get(
                  header,
                )
              : null;
          },
          { prefix: PAGE_CACHE_PREFIX, header: SESSION_EXPIRES_HEADER },
        ),
      )
      .toBe(expiresAt);
    await expect
      .poll(() => Date.now() >= Date.parse(expiresAt), { timeout: 15_000 })
      .toBe(true);
    await context.setOffline(true);
    await page.goto("/today");
    await expect(
      page.getByRole("heading", { name: "Пока нет сети" }),
    ).toBeVisible();
    await expect(page.locator("[data-pwa-offline]")).toHaveCount(0);
    await expect.poll(() => pageCacheURLs(page)).toEqual([]);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("отзыв сессии в БД без выхода очищает копии после auth redirect и перед офлайном", async ({
  page,
  context,
  loginAs,
  students,
}) => {
  await loginAs("anna");
  await controlled(page);
  await waitSnapshot(page, "/today");
  await page.goto("/schedule");
  await waitSnapshot(page, "/schedule");
  const student = await students.get("anna");
  const sql = createDatabase(1);
  try {
    await sql`delete from sessions where user_id = ${student.actor.userId}`;
    // Learn revocation through an opaque redirect without mounting /login or calling logout.
    await page.evaluate(async () => {
      await fetch("/today", {
        redirect: "manual",
        headers: { Accept: "text/html" },
        cache: "no-store",
      });
    });
    await expect.poll(() => pageCacheURLs(page)).toEqual([]);
    await context.setOffline(true);
    for (const path of ["/today", "/schedule"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "Пока нет сети" }),
      ).toBeVisible();
      await expect(page.locator("[data-pwa-offline]")).toHaveCount(0);
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("ложный online без сети сохраняет открытый документ и баннер копии", async ({
  page,
  context,
  loginAs,
}) => {
  await loginAs("anna");
  await controlled(page);
  await waitSnapshot(page, "/today");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("[data-pwa-offline]")).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await markDocument(page, "offline-document");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "pwaOnlineMarker")))
    .toBe("offline-document");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("[data-pwa-offline]")).toContainText(
    "Нет сети — показана версия от",
  );
});

test("ложный online старой копии после клика не отменяет офлайн-переход на Сегодня", async ({
  page,
  context,
  loginAs,
}) => {
  await loginAs("anna");
  await controlled(page);
  await waitSnapshot(page, "/today");
  await page.goto("/schedule");
  await waitSnapshot(page, "/schedule");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("[data-pwa-offline]")).toBeVisible();
  await page.evaluate(() => {
    // This listener runs after PwaStatus's capture listener on the same document.
    document.addEventListener(
      "click",
      () => {
        sessionStorage.setItem(
          "pwa-online-during-navigation",
          JSON.stringify({ path: location.pathname, online: navigator.onLine }),
        );
        window.dispatchEvent(new Event("online"));
      },
      { capture: true, once: true },
    );
  });
  await page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .filter({ visible: true })
    .getByRole("link", { name: "Сегодня", exact: true })
    .click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("[data-pwa-offline]")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Сейчас", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("pwa-online-during-navigation"),
    ),
  ).toBe(JSON.stringify({ path: "/schedule", online: false }));
});

test("настоящий возврат сети заменяет копию свежей страницей без повторной перезагрузки", async ({
  page,
  context,
  loginAs,
}, info) => {
  await recordConnectivity(page);
  try {
    await loginAs("anna");
    await controlled(page);
    await waitSnapshot(page, "/today");
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("[data-pwa-offline]")).toBeVisible();
    await markDocument(page, "saved-document");
    await context.setOffline(false);
    await expect(page.locator("[data-pwa-offline]")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-pwa-saved-at");
    await expect(
      page.getByRole("heading", { name: "Сейчас", exact: true }),
    ).toBeVisible();
    await waitWarmFetch(page);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "pwaOnlineMarker")))
      .toBeUndefined();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await markDocument(page, "fresh-document");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "pwaOnlineMarker")))
      .toBe("fresh-document");
  } finally {
    await attachConnectivity(page, info);
  }
});

test("Сегодня и Расписание доступны офлайн; выход и смена студента удаляют прежний кэш", async ({
  page,
  context,
  loginAs,
}, info) => {
  await loginAs("anna");
  await controlled(page);
  await waitSnapshot(page, "/today");
  await page
    .getByRole("link", { name: "Открыть расписание", exact: true })
    .click();
  await expect(page).toHaveURL(/\/schedule$/);
  await waitSnapshot(page, "/schedule");
  await expect(page.locator("[data-pwa-offline]")).toHaveCount(0);
  const transfer = await page
    .getByTestId("schedule-change")
    .first()
    .textContent();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Расписание", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("schedule-change").first()).toHaveText(
    transfer ?? "",
  );
  await expect(page.locator("[data-pwa-offline]")).toContainText(
    "Нет сети — показана версия от",
  );
  await capture(page, "offline-schedule", info.project.name);
  await page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .filter({ visible: true })
    .getByRole("link", { name: "Сегодня", exact: true })
    .click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole("heading", { name: "Сейчас", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-pwa-offline]")).toContainText("(МСК)");
  await capture(page, "offline-today", info.project.name);
  await page.goto("/grades");
  await expect(
    page.getByRole("heading", { name: "Пока нет сети" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  await context.setOffline(false);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => pageCacheURLs(page)).toEqual([]);
  await context.setOffline(true);
  await page.goto("/today");
  await expect(
    page.getByRole("heading", { name: "Пока нет сети" }),
  ).toBeVisible();
  await expect(page.locator("[data-pwa-offline]")).toHaveCount(0);
  await context.setOffline(false);
  await loginAs("timur");
  await controlled(page);
  await waitSnapshot(page, "/today");
  await expect.poll(() => pageCacheURLs(page)).toEqual(["/today"]);
  await context.setOffline(true);
  await page.goto("/schedule");
  await expect(
    page.getByRole("heading", { name: "Пока нет сети" }),
  ).toBeVisible();
  await page.goto("/today");
  await expect(page.locator("[data-pwa-offline]")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Анна");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cachedPaths = (
          await Promise.all(
            (
              await caches.keys()
            ).map(async (name) =>
              (
                await (await caches.open(name)).keys()
              ).map((request) => new URL(request.url).pathname),
            ),
          )
        ).flat();
        return cachedPaths.some(
          (path) =>
            path.startsWith("/api/") ||
            path.startsWith("/staff/") ||
            path === "/profile" ||
            path === "/login",
        );
      }),
    )
    .toBe(false);
});

test("Chromium предлагает установку и запоминает закрытие; подсказка не перекрывает навигацию", async ({
  page,
  loginAs,
}, info) => {
  await loginAs("anna");
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }),
  ).toBeVisible();
  // The browser-owned event cannot be triggered by a page action in headless Chromium.
  async function offer() {
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: async () => {
          document.documentElement.dataset.pwaPrompted = "1";
        },
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(event);
    });
  }
  await offer();
  const hint = page.getByRole("region", { name: "Установка Пульса" });
  await expect(hint).toBeVisible();
  await capture(page, "install-chromium", info.project.name);
  await expect
    .poll(() =>
      hint.evaluate((element) => {
        const hint = element.getBoundingClientRect();
        return [
          ...document.querySelectorAll(
            ".mobile-navigation, .assistant-trigger",
          ),
        ].some((other) => {
          const rect = other.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            hint.left < rect.right &&
            hint.right > rect.left &&
            hint.top < rect.bottom &&
            hint.bottom > rect.top
          );
        });
      }),
    )
    .toBe(false);
  await page
    .getByRole("button", { name: "Установить на экран", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-pwa-prompted", "1");
  await offer();
  await page
    .getByRole("button", { name: "Больше не показывать подсказку установки" })
    .click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }),
  ).toBeVisible();
  await offer();
  await expect(hint).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("pulse-install-dismissed")),
    )
    .toBe("1");
});

test.describe("iOS Safari", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  test("показывает инструкцию и скрывает её после установки", async ({
    page,
    loginAs,
  }, info) => {
    await loginAs("anna");
    await expect(
      page.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Поделиться → На экран «Домой»", { exact: true }),
    ).toBeVisible();
    await capture(page, "install-ios", info.project.name);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true });
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.locator("[data-pwa-install]")).toHaveCount(0);
  });
});
