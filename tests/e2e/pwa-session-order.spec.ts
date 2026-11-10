import type { APIResponse, Page, Route, Worker } from "@playwright/test";
import { CryptoSessionTokens } from "../../src/infrastructure/auth/session-tokens";
import { createDatabase } from "../../src/infrastructure/db/client";
import { PostgresSessionStore } from "../../src/infrastructure/db/repositories/identity/sessions";
import { UuidV7Generator } from "../../src/infrastructure/system/id-generator";
import {
  PAGE_CACHE_PREFIX,
  SESSION_HEADER,
  SESSION_STATE_CACHE,
} from "../../src/ui/shell/pwa-cache";
import { expect, test } from "../security/student-login";

test.use({ serviceWorkers: "allow" });

async function controlled(page: Page) {
  await expect
    .poll(
      () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function observeLateEvent(worker: Worker) {
  await worker.evaluate(() => {
    const prototype = Reflect.get(globalThis, "ExtendableEvent").prototype as {
      waitUntil(
        this: Event & { request?: Request },
        promise: Promise<unknown>,
      ): void;
    };
    const original = prototype.waitUntil;
    const finished = Promise.withResolvers<void>();
    let pending = 0;
    let otherPending = 0;
    const otherWaiters = new Set<() => void>();
    function settled() {
      if (--pending === 0) finished.resolve();
    }
    function otherSettled() {
      if (--otherPending !== 0) return;
      for (const resolve of otherWaiters) resolve();
      otherWaiters.clear();
    }
    prototype.waitUntil = function (promise) {
      const url = this.request ? new URL(this.request.url) : undefined;
      if (url?.searchParams.get("pwa-order") === "unseen-a") {
        pending++;
        void promise.then(settled, settled);
      } else {
        otherPending++;
        void promise.then(otherSettled, otherSettled);
      }
      original.call(this, promise);
    };
    // A slow fallback can finish the page's fetch before the network/cache work.
    Reflect.set(globalThis, "pwaLateEventFinished", finished.promise);
    Reflect.set(globalThis, "pwaOtherEventsFinished", () =>
      otherPending === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => otherWaiters.add(resolve)),
    );
    Reflect.set(globalThis, "pwaOriginalWaitUntil", original);
  });
}

async function savedSession(page: Page) {
  return page.evaluate(
    async ({ prefix, stateCache }) => {
      const state = await (await caches.open(stateCache)).match(
        "/__pwa_session_state",
      );
      const session = state ? (await state.json()).session : null;
      const names = (await caches.keys()).filter((name) =>
        name.startsWith(prefix),
      );
      const snapshots = await Promise.all(
        names.map(async (name) => {
          const response = await (await caches.open(name)).match("/today");
          return response?.headers.get("X-Pulse-Session") ?? null;
        }),
      );
      return { session, snapshots };
    },
    { prefix: PAGE_CACHE_PREFIX, stateCache: SESSION_STATE_CACHE },
  );
}

test("поздний HTML ещё не виденной сессии A после входа B не заменяет офлайн-копию B", async ({
  page,
  context,
  baseURL,
  students,
}) => {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  const studentA = await students.get("anna");
  const studentB = await students.get("timur");
  const sql = createDatabase(1);
  const sessions = new PostgresSessionStore(() => sql);
  const tokens = new CryptoSessionTokens();
  const tokenA = tokens.generate();
  const sessionId = new UuidV7Generator().next();
  const loginStarted = Promise.withResolvers<void>();
  const allowLogin = Promise.withResolvers<void>();
  const responseA = Promise.withResolvers<APIResponse>();
  const releaseA = Promise.withResolvers<void>();
  let login: Promise<void> | undefined;
  let fetchA: Promise<string> | undefined;
  let worker: Worker | undefined;
  const second = await context.newPage();
  async function intercept(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    if (!request.serviceWorker()) return route.continue();
    if (url.pathname === "/login" && request.method() === "POST") {
      loginStarted.resolve();
      await allowLogin.promise;
      return route.continue();
    }
    if (url.searchParams.get("pwa-order") === "unseen-a") {
      try {
        const response = await route.fetch({ maxRedirects: 0 });
        await response.body();
        responseA.resolve(response);
        await releaseA.promise;
        return route.fulfill({ response });
      } catch (error) {
        responseA.reject(error);
        throw error;
      }
    }
    return route.continue();
  }
  try {
    // The static tab has no polling or warm-up requests that could reveal A.
    await page.goto("/offline.html");
    await second.goto("/login");
    await controlled(page);
    await controlled(second);
    await second
      .getByLabel("Логин", { exact: true })
      .fill(studentB.credentials.login);
    await second
      .getByLabel("Пароль", { exact: true })
      .fill(studentB.credentials.password);
    await expect
      .poll(() => savedSession(page))
      .toEqual({ session: null, snapshots: [] });
    worker = context
      .serviceWorkers()
      .find((entry) => new URL(entry.url()).pathname === "/sw.js");
    if (!worker) throw new Error("Не найден активный service worker.");
    await observeLateEvent(worker);
    const now = new Date();
    await sessions.create({
      id: sessionId,
      userId: studentA.actor.userId,
      tokenHash: tokens.hash(tokenA),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    });
    await context.addCookies([
      {
        name: "__Host-pulse-session",
        value: tokenA,
        // A __Host- cookie needs path "/" and a host-only domain; `url` makes Chromium reject it.
        domain: new URL(baseURL).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await context.route("**/*", intercept);
    login = second.getByRole("button", { name: "Войти", exact: true }).click();
    await loginStarted.promise;
    fetchA = page.evaluate(async () => {
      const response = await fetch("/today?pwa-order=unseen-a", {
        headers: { Accept: "text/html" },
        cache: "no-store",
      });
      return response.text();
    });
    const held = await responseA.promise;
    expect(held.status()).toBe(200);
    expect(held.headers()["x-pulse-cacheable"]).toBe("1");
    expect(held.headers()["set-cookie"]).toBeUndefined();
    const fingerprintA = held.headers()[SESSION_HEADER.toLowerCase()];
    expect(fingerprintA).toMatch(/^[a-f0-9]{64}$/);
    expect(await held.text()).toContain("Анна");
    expect(await savedSession(page)).toEqual({ session: null, snapshots: [] });
    allowLogin.resolve();
    await login;
    await expect(second).toHaveURL(/\/today$/);
    const fingerprintB = await page.evaluate(async () => {
      const response = await fetch("/today?pwa-order=current-b", {
        headers: { Accept: "text/html" },
        cache: "no-store",
      });
      await response.text();
      return response.headers.get("X-Pulse-Session");
    });
    expect(fingerprintB).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintB).not.toBe(fingerprintA);
    await expect
      .poll(() => savedSession(page), { timeout: 20_000 })
      .toEqual({
        session: fingerprintB,
        snapshots: [fingerprintB],
      });
    // Stop B's polling before releasing A, so a later B response cannot mask the bug.
    await second.goto("/offline.html");
    await worker.evaluate(() =>
      Reflect.get(globalThis, "pwaOtherEventsFinished")(),
    );
    releaseA.resolve();
    await fetchA;
    await worker.evaluate(() =>
      Reflect.get(globalThis, "pwaLateEventFinished"),
    );
    expect(await savedSession(page)).toEqual({
      session: fingerprintB,
      snapshots: [fingerprintB],
    });
    await context.unroute("**/*", intercept);
    await context.setOffline(true);
    await page.goto("/today");
    await expect(page.locator("[data-pwa-offline]")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Тимур");
    await expect(page.getByRole("main")).not.toContainText("Анна");
  } finally {
    allowLogin.resolve();
    releaseA.resolve();
    try {
      await Promise.allSettled([login, fetchA]);
      await context.unroute("**/*", intercept);
      await worker?.evaluate(() => {
        const original = Reflect.get(globalThis, "pwaOriginalWaitUntil");
        if (original)
          Reflect.get(globalThis, "ExtendableEvent").prototype.waitUntil =
            original;
        for (const key of [
          "pwaLateEventFinished",
          "pwaOtherEventsFinished",
          "pwaOriginalWaitUntil",
        ])
          Reflect.deleteProperty(globalThis, key);
      });
    } finally {
      try {
        await sessions.revoke(sessionId);
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
  }
});
