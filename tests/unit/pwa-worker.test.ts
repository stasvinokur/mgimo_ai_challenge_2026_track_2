import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_OFFLINE_AGE_MS,
  PAGE_CACHE_PREFIX,
  PwaPageCache,
  SESSION_EXPIRES_HEADER,
  SESSION_STATE_CACHE,
} from "@/ui/shell/pwa-cache";
import { memoryStorage } from "./pwa-storage";

const runtime = vi.hoisted(() => ({
  handler: null as unknown as (input: {
    request: Request;
    url: URL;
    event: { waitUntil(promise: Promise<unknown>): void };
  }) => Promise<Response>,
}));
vi.mock("serwist", () => ({
  Serwist: class {
    constructor(options: {
      runtimeCaching: { handler: typeof runtime.handler }[];
    }) {
      runtime.handler = options.runtimeCaching[0]
        ?.handler as typeof runtime.handler;
    }
    addEventListeners() {}
    async matchPrecache() {
      return new Response("Пока нет сети", {
        headers: { "Content-Type": "text/html" },
      });
    }
  },
}));
const origin = "https://pulse.example";
let storage: CacheStorage;
let listeners: Map<string, (event: unknown) => void>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
async function run(
  path = "/today",
  headers = { Accept: "text/html" },
  navigation = false,
) {
  const waiting: Promise<unknown>[] = [];
  const request = new Request(`${origin}${path}`, { headers });
  if (navigation) Object.defineProperty(request, "mode", { value: "navigate" });
  const response = await runtime.handler({
    request,
    url: new URL(request.url),
    event: {
      waitUntil(promise) {
        waiting.push(promise);
      },
    },
  });
  await Promise.all(waiting);
  return response;
}
function html(body = "Версия с сервера", headers = {}, status = 200) {
  return new Response(`<html><body>${body}</body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html",
      "X-Pulse-Cacheable": "1",
      "X-Pulse-Session": "a".repeat(64),
      [SESSION_EXPIRES_HEADER]: new Date(
        Date.now() + MAX_OFFLINE_AGE_MS,
      ).toISOString(),
      ...headers,
    },
  });
}

async function restartWorker(buildId: string) {
  vi.resetModules();
  listeners = new Map();
  vi.stubGlobal("self", {
    location: { origin },
    __SW_MANIFEST: [],
    __PULSE_BUILD_ID: buildId,
    setTimeout,
    clearTimeout,
    addEventListener(name: string, listener: (event: unknown) => void) {
      listeners.set(name, listener);
    },
  });
  await import("@/ui/shell/pwa-worker");
}
async function activate() {
  const waiting: Promise<unknown>[] = [];
  listeners.get("activate")?.({
    waitUntil(promise: Promise<unknown>) {
      waiting.push(promise);
    },
  });
  await Promise.all(waiting);
}
beforeEach(async () => {
  storage = memoryStorage().storage;
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("caches", storage);
  await restartWorker("build-a");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("поведение service worker", () => {
  it.each(["/today", "/schedule", "/login"])(
    "GET %s начинает и возвращает сеть, пока инициализация кэша заблокирована",
    async (path) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const open = storage.open.bind(storage);
      vi.spyOn(storage, "open").mockImplementation(async (name) => {
        entered.resolve();
        await release.promise;
        return open(name);
      });
      const activating = activate();
      await entered.promise;
      fetcher.mockResolvedValueOnce(html("Живая сеть"));
      const waiting: Promise<unknown>[] = [];
      const request = new Request(`${origin}${path}`, {
        headers: { Accept: "text/html" },
      });
      Object.defineProperty(request, "mode", { value: "navigate" });
      try {
        const result = runtime.handler({
          request,
          url: new URL(request.url),
          event: {
            waitUntil(promise) {
              waiting.push(promise);
            },
          },
        });
        // No microtask, storage access or lock acquisition may precede fetch.
        expect(fetcher).toHaveBeenCalledExactlyOnceWith(request);
        expect(await (await result).text()).toContain("Живая сеть");
      } finally {
        release.resolve();
        await activating;
        await Promise.all(waiting);
      }
    },
  );
  it("POST входа B → ещё не виденный GET A → HTML B → поздний HTML A сохраняет только B", async () => {
    const loginStarted = Promise.withResolvers<void>();
    const loginResponse = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => {
      loginStarted.resolve();
      return loginResponse.promise;
    });
    let login: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: new Request(`${origin}/login`, { method: "POST" }),
      respondWith(result: Promise<Response>) {
        login = result;
      },
    });
    await loginStarted.promise;
    const lateA = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => lateA.promise);
    const requestA = run();
    expect(fetcher).toHaveBeenCalledTimes(2);
    loginResponse.resolve(new Response("Вход B завершён"));
    await login;
    fetcher.mockResolvedValueOnce(
      html("Студент B", { "X-Pulse-Session": "b".repeat(64) }),
    );
    await run();
    lateA.resolve(html("Студент A"));
    await requestA;
    fetcher.mockRejectedValue(new Error("offline"));
    const offline = await run("/today", { Accept: "text/html" }, true);
    expect(await offline.text()).toContain("Студент B");
    expect(await storage.keys()).toEqual([
      SESSION_STATE_CACHE,
      `${PAGE_CACHE_PREFIX}build-a-${"b".repeat(64)}`,
    ]);
  });
  it.each(["build-a", "legacy"])(
    "новая сборка удаляет HTML %s и отдаёт offline.html до нового посещения онлайн",
    async (oldBuild) => {
      const oldHTML = html(
        'Старая сборка<script src="/_next/static/chunks/old.js"></script>',
      );
      if (oldBuild === "legacy") {
        const pages = new PwaPageCache(storage, origin);
        await pages.save(
          new Request(`${origin}/today`, { headers: { Accept: "text/html" } }),
          oldHTML,
          pages.startRequest(),
        );
      } else {
        fetcher.mockResolvedValueOnce(oldHTML);
        await run();
      }
      await restartWorker("build-b");
      await activate();
      fetcher.mockRejectedValue(new Error("offline"));
      expect(
        await (await run("/today", { Accept: "text/html" }, true)).text(),
      ).toBe("Пока нет сети");
      expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
      fetcher.mockResolvedValueOnce(html("Новая сборка"));
      await run();
      fetcher.mockRejectedValue(new Error("offline"));
      expect(await (await run()).text()).toContain("Новая сборка");
    },
  );
  it("перезапуск той же сборки сохраняет снимок и его офлайн-плашку", async () => {
    fetcher.mockResolvedValueOnce(html("Текущая сборка"));
    await run();
    await restartWorker("build-a");
    await activate();
    fetcher.mockRejectedValue(new Error("offline"));
    const body = await (await run()).text();
    expect(body).toContain("Текущая сборка");
    expect(body).toContain('data-pwa-snapshot-reason="offline"');
  });
  it("поздняя запись старого worker после активации не читается новой сборкой", async () => {
    fetcher.mockResolvedValueOnce(html("Старая сборка"));
    await run();
    const late = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => late.promise);
    const oldRequest = run("/schedule");
    await restartWorker("build-b");
    await activate();
    late.resolve(html("Поздний HTML старой сборки"));
    await oldRequest;
    fetcher.mockRejectedValue(new Error("offline"));
    expect(
      await (await run("/schedule", { Accept: "text/html" }, true)).text(),
    ).toBe("Пока нет сети");
    expect(
      (await storage.keys()).filter((name) =>
        name.startsWith(PAGE_CACHE_PREFIX),
      ),
    ).toEqual([`${PAGE_CACHE_PREFIX}build-a-${"a".repeat(64)}`]);
  });
  it("смена сборки сохраняет отзыв A и разрешает новые снимки B", async () => {
    fetcher.mockResolvedValueOnce(html("Студент A"));
    await run();
    fetcher.mockResolvedValueOnce(
      html("Студент B", { "X-Pulse-Session": "b".repeat(64) }),
    );
    await run();
    await restartWorker("build-b");
    await activate();
    fetcher.mockResolvedValueOnce(html("Поздний ответ A"));
    await run();
    fetcher.mockRejectedValue(new Error("offline"));
    expect(
      await (await run("/today", { Accept: "text/html" }, true)).text(),
    ).toBe("Пока нет сети");
    fetcher.mockResolvedValueOnce(
      html("Новая копия B", { "X-Pulse-Session": "b".repeat(64) }),
    );
    await run();
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await (await run()).text()).toContain("Новая копия B");
  });
  it("несохранённая страница получает понятный offline fallback", async () => {
    fetcher.mockRejectedValue(new Error("offline"));
    expect(
      await (await run("/grades", { Accept: "text/html" }, true)).text(),
    ).toBe("Пока нет сети");
  });
  it("API не получает fallback даже при открытии адреса как документа", async () => {
    fetcher.mockRejectedValue(new Error("offline"));
    expect(
      (await run("/api/me/pulse", { Accept: "text/html" }, true)).type,
    ).toBe("error");
  });
  it("сначала возвращает сеть, затем последнюю HTML-версию без сети", async () => {
    fetcher.mockResolvedValueOnce(html());
    expect(await (await run()).text()).toContain("Версия с сервера");
    fetcher.mockRejectedValue(new Error("offline"));
    const saved = await run();
    const body = await saved.text();
    expect(body).toContain("data-pwa-saved-at");
    expect(body).toContain('data-pwa-snapshot-reason="offline"');
    expect(saved.headers.get("X-Pulse-Saved-At")).toBeTruthy();
  });
  it("живая сеть обновляет snapshot, не помечая онлайн-ответ офлайном", async () => {
    fetcher.mockResolvedValueOnce(html("Первая"));
    await run();
    fetcher.mockResolvedValueOnce(html("Вторая"));
    const live = await run();
    expect(await live.text()).toBe("<html><body>Вторая</body></html>");
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await (await run()).text()).toContain("Вторая");
  });
  it("через 3 секунды отдаёт snapshot, запоздавшая сеть обновляет следующую версию", async () => {
    fetcher.mockResolvedValueOnce(html());
    await run();
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => undefined;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const waiting: Promise<unknown>[] = [];
    const request = new Request(`${origin}/today`, {
      headers: { Accept: "text/html" },
    });
    const result = runtime.handler({
      request,
      url: new URL(request.url),
      event: {
        waitUntil(promise) {
          waiting.push(promise);
        },
      },
    });
    await vi.advanceTimersByTimeAsync(3000);
    const body = await (await result).text();
    expect(body).toContain("data-pwa-saved-at");
    expect(body).toContain('data-pwa-snapshot-reason="slow"');
    finish(html("Обновлённая"));
    await Promise.all(waiting);
    fetcher.mockRejectedValue(new Error("offline"));
    const refreshed = await (await run()).text();
    expect(refreshed).toContain("Обновлённая");
    expect(refreshed).toContain('data-pwa-snapshot-reason="offline"');
  });
  it.each(["absent", "unreadable", "expired"])(
    "таймаут без доступной копии (%s) продолжает ждать сеть",
    async (cacheState) => {
      vi.useFakeTimers();
      if (cacheState === "expired") {
        fetcher.mockResolvedValueOnce(
          html("Истекающая", {
            [SESSION_EXPIRES_HEADER]: new Date(Date.now() + 1000).toISOString(),
          }),
        );
        await run();
      }
      if (cacheState === "unreadable")
        vi.spyOn(storage, "keys").mockRejectedValue(
          new Error("storage unavailable"),
        );
      let finish: (response: Response) => void = () => undefined;
      fetcher.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const waiting: Promise<unknown>[] = [];
      const request = new Request(`${origin}/today`, {
        headers: { Accept: "text/html" },
      });
      Object.defineProperty(request, "mode", { value: "navigate" });
      const result = runtime.handler({
        request,
        url: new URL(request.url),
        event: {
          waitUntil(promise) {
            waiting.push(promise);
          },
        },
      });
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false);
      finish(html("Медленный ответ сети"));
      const response = await result;
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        "<html><body>Медленный ответ сети</body></html>",
      );
      await Promise.all(waiting);
      if (cacheState === "absent") {
        fetcher.mockRejectedValue(new Error("offline"));
        expect(await (await run()).text()).toContain("Медленный ответ сети");
      }
    },
  );
  it.each(["/api/me/pulse", "/staff/requests", "/requests"])(
    "никогда не сохраняет %s",
    async (path) => {
      fetcher.mockResolvedValueOnce(html());
      await run(path);
      expect(
        (await storage.keys()).filter((name) =>
          name.startsWith(PAGE_CACHE_PREFIX),
        ),
      ).toEqual([]);
    },
  );
  it.each([{ RSC: "1" }, { "Next-Action": "test" }])(
    "запросы %o не получают HTML из кэша",
    async (headers) => {
      fetcher.mockResolvedValueOnce(html());
      await run();
      fetcher.mockRejectedValue(new Error("offline"));
      expect(
        (await run("/today", { Accept: "text/html", ...headers })).type,
      ).toBe("error");
    },
  );
  it("ошибка HTTP возвращается как есть и не заменяет snapshot", async () => {
    fetcher.mockResolvedValueOnce(html());
    await run();
    fetcher.mockResolvedValueOnce(html("Ошибка", {}, 500));
    expect((await run()).status).toBe(500);
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await (await run()).text()).toContain("Версия с сервера");
  });
  it("ответ с cookie не сохраняется", async () => {
    fetcher.mockResolvedValueOnce(
      html("Продление", { "Set-Cookie": "fictional=1" }),
    );
    await run();
    const names = await storage.keys();
    for (const name of names)
      expect(
        await (await storage.open(name)).match(`${origin}/today`),
      ).toBeUndefined();
  });
  it("POST очищает snapshots до вызова сети", async () => {
    fetcher.mockResolvedValueOnce(html());
    await run();
    fetcher.mockImplementationOnce(async () => {
      expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
      return new Response("Сетевой ответ");
    });
    let result: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: new Request(`${origin}/profile`, {
        method: "POST",
        headers: { "Next-Action": "logout" },
      }),
      respondWith(response: Promise<Response>) {
        result = response;
      },
    });
    expect(await (await result)?.text()).toBe("Сетевой ответ");
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
    fetcher.mockResolvedValueOnce(html("После действия"));
    await run();
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await (await run()).text()).toContain("После действия");
  });
  it("сообщение выхода подтверждается после удаления данных", async () => {
    fetcher.mockResolvedValueOnce(html());
    await run();
    const ack = vi.fn();
    let result: Promise<unknown> | undefined;
    listeners.get("message")?.({
      data: { type: "PULSE_CLEAR_PAGES" },
      ports: [{ postMessage: ack }],
      waitUntil(promise: Promise<unknown>) {
        result = promise;
      },
    });
    await result;
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });
  it.each(["opaqueredirect", "followed", "location"])(
    "редирект %s завершает сессию и не оставляет копию для офлайна",
    async (kind) => {
      fetcher.mockResolvedValueOnce(html());
      await run();
      const redirect = new Response(null, {
        status: kind === "followed" ? 200 : 302,
        headers: kind === "location" ? { Location: "/login?next=/today" } : {},
      });
      if (kind === "opaqueredirect")
        Object.defineProperty(redirect, "type", { value: "opaqueredirect" });
      if (kind === "followed") {
        Object.defineProperty(redirect, "redirected", { value: true });
        Object.defineProperty(redirect, "url", {
          value: `${origin}/login?next=/today`,
        });
      }
      fetcher.mockResolvedValueOnce(redirect);
      await run();
      expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
      fetcher.mockRejectedValue(new Error("offline"));
      expect(
        await (await run("/today", { Accept: "text/html" }, true)).text(),
      ).toBe("Пока нет сети");
    },
  );
  it("истёкшая сессия получает offline fallback и не восстанавливается запоздавшей сетью", async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValueOnce(
      html("Истекающая", {
        [SESSION_EXPIRES_HEADER]: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    await run();
    await vi.advanceTimersByTimeAsync(1000);
    fetcher.mockRejectedValue(new Error("offline"));
    expect(
      await (await run("/today", { Accept: "text/html" }, true)).text(),
    ).toBe("Пока нет сети");
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("отказ очистки не блокирует POST выхода и Server Action", async () => {
    fetcher.mockResolvedValueOnce(html());
    await run();
    vi.spyOn(storage, "delete").mockRejectedValue(
      new Error("storage unavailable"),
    );
    fetcher.mockResolvedValueOnce(new Response("Выход выполнен"));
    let result: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: new Request(`${origin}/profile`, {
        method: "POST",
        headers: { "Next-Action": "logout" },
      }),
      respondWith(response: Promise<Response>) {
        result = response;
      },
    });
    expect(await (await result)?.text()).toBe("Выход выполнен");
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValue(new Error("offline"));
    expect(
      await (await run("/today", { Accept: "text/html" }, true)).text(),
    ).toBe("Пока нет сети");
  });
});
