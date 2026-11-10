import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_TTL_MS } from "@/domain/identity/session-policy";
import {
  canSavePage,
  isPageSnapshot,
  MAX_OFFLINE_AGE_MS,
  offlineSnapshot,
  PAGE_CACHE_PREFIX,
  PwaPageCache,
  SAVED_AT_HEADER,
  SESSION_EXPIRES_HEADER,
  SESSION_STATE_CACHE,
} from "@/ui/shell/pwa-cache";
import { memoryStorage } from "./pwa-storage";

const origin = "https://pulse.example";
const sessionA = "a".repeat(64);
const sessionB = "b".repeat(64);
function request(path = "/today", headers = {}, method = "GET") {
  return new Request(`${origin}${path}`, {
    headers: { Accept: "text/html", ...headers },
    method,
  });
}
function response(session = sessionA, extra = {}, status = 200) {
  return new Response(
    `<html lang="ru"><body>Сохранённое расписание ${session}</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html",
        "X-Pulse-Cacheable": "1",
        "X-Pulse-Session": session,
        [SESSION_EXPIRES_HEADER]: new Date(
          Date.now() + MAX_OFFLINE_AGE_MS,
        ).toISOString(),
        "Cache-Control": "private, no-store",
        ...extra,
      },
    },
  );
}

afterEach(() => vi.useRealTimers());

describe("границы персонального PWA-кэша", () => {
  it.each(["/today", "/schedule", "/schedule?view=week&week=2026-W45"])(
    "сохраняет только HTML %s",
    (path) => {
      expect(isPageSnapshot(request(path), origin)).toBe(true);
    },
  );
  it.each([
    "/api/me/pulse",
    "/staff/requests",
    "/requests",
    "/schedule/token",
    "/today/other",
    "/today?_rsc=1",
  ])("не сохраняет %s", (path) => {
    expect(isPageSnapshot(request(path), origin)).toBe(false);
  });
  it.each([
    { RSC: "1" },
    { RSC: "0" },
    { "Next-Action": "test" },
    { Accept: "text/x-component" },
  ])("не сохраняет RSC и actions: %o", (headers) => {
    expect(isPageSnapshot(request("/today", headers), origin)).toBe(false);
  });
  it("не сохраняет POST и чужой origin", () => {
    expect(isPageSnapshot(request("/today", {}, "POST"), origin)).toBe(false);
    expect(
      isPageSnapshot(
        new Request("https://other.example/today", {
          headers: { Accept: "text/html" },
        }),
        origin,
      ),
    ).toBe(false);
  });
  it.each([201, 302, 403, 404, 500])("не сохраняет ответ %s", (status) => {
    expect(canSavePage(response(sessionA, {}, status), origin)).toBeFalsy();
  });
  it.each([
    { "Set-Cookie": "test=fictional" },
    { "X-Pulse-Cacheable": "0" },
    { "X-Pulse-Session": "none" },
    { "Content-Type": "text/x-component" },
  ])("не сохраняет небезопасный ответ %o", (headers) => {
    expect(canSavePage(response(sessionA, headers), origin)).toBeFalsy();
  });
  it("не сохраняет редирект и ответ другого origin", () => {
    const redirected = response();
    Object.defineProperty(redirected, "redirected", { value: true });
    expect(canSavePage(redirected, origin)).toBe(false);
    const foreign = response();
    Object.defineProperty(foreign, "url", {
      value: "https://other.example/today",
    });
    expect(canSavePage(foreign, origin)).toBe(false);
  });
  it("хранит последнюю версию каждого экрана с временем сохранения вопреки HTTP no-store (D-28)", async () => {
    const { storage, data } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    await pages.save(
      request("/schedule?view=week"),
      response(),
      pages.startRequest(),
    );
    await pages.save(
      request("/schedule?view=today"),
      response(),
      pages.startRequest(),
    );
    const cache = data.get(`${PAGE_CACHE_PREFIX}${sessionA}`);
    expect([...(cache?.keys() ?? [])]).toEqual([
      `${origin}/today`,
      `${origin}/schedule`,
    ]);
    const saved = await pages.read("/today");
    expect(saved?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(
      Number.isFinite(Date.parse(saved?.headers.get(SAVED_AT_HEADER) ?? "")),
    ).toBe(true);
  });
  it("смена сессии удаляет страницы прошлого студента, включая после перезапуска SW", async () => {
    const { storage } = memoryStorage();
    const first = new PwaPageCache(storage, origin);
    await first.save(request(), response(), first.startRequest());
    const restarted = new PwaPageCache(storage, origin);
    await restarted.save(
      request("/schedule"),
      response(sessionB),
      restarted.startRequest(),
    );
    expect(await restarted.read("/today")).toBeUndefined();
    expect(await storage.keys()).toEqual([
      SESSION_STATE_CACHE,
      `${PAGE_CACHE_PREFIX}${sessionB}`,
    ]);
  });
  it("выход удаляет персональные страницы, сохраняя только публичную статику", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await storage.open("serwist-precache-static");
    await pages.save(request(), response(), pages.startRequest());
    const generation = pages.startRequest();
    await pages.clear();
    await pages.save(request("/schedule"), response(), generation);
    expect(await pages.read("/today")).toBeUndefined();
    expect(await storage.keys()).toEqual([
      "serwist-precache-static",
      SESSION_STATE_CACHE,
    ]);
  });
  it("быстрый API первой сессии не отбрасывает уже загружаемый HTML той же сессии", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    const generation = pages.startRequest();
    await pages.observe(response(), generation);
    await pages.save(request(), response(), generation);
    expect(await pages.read("/today")).toBeDefined();
  });
  it.each([false, true])(
    "выход → GET A → HTML B → поздний A не возвращает A, перезапуск: %s",
    async (restart) => {
      const { storage } = memoryStorage();
      let pages = new PwaPageCache(storage, origin);
      await pages.save(request(), response(), pages.startRequest());
      await pages.clear();
      if (restart) pages = new PwaPageCache(storage, origin);
      const generation = pages.startRequest();
      const late = Promise.withResolvers<Response>();
      const saving = late.promise.then((value) =>
        pages.save(request(), value, generation),
      );
      await pages.save(request(), response(sessionB), generation);
      late.resolve(response(sessionA));
      await saving;
      const saved = await pages.read("/today");
      expect(saved?.headers.get("X-Pulse-Session")).toBe(sessionB);
      const body = await saved?.text();
      expect(body).toContain(sessionB);
      expect(body).not.toContain(sessionA);
      expect(await storage.keys()).toEqual([
        SESSION_STATE_CACHE,
        `${PAGE_CACHE_PREFIX}${sessionB}`,
      ]);
    },
  );
  it.each(["выход", "истечение", "отзыв", "смена"])(
    "%s навсегда отклоняет поздний ответ A даже с новым поколением и после перезапуска",
    async (reason) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { storage } = memoryStorage();
      const pages = new PwaPageCache(storage, origin);
      await pages.save(
        request(),
        response(sessionA, {
          [SESSION_EXPIRES_HEADER]: new Date(Date.now() + 1000).toISOString(),
        }),
        pages.startRequest(),
      );
      if (reason === "выход") await pages.clear();
      if (reason === "истечение") {
        vi.setSystemTime(Date.now() + 1000);
        expect(await pages.read("/today")).toBeUndefined();
      }
      if (reason === "отзыв")
        await pages.observe(response("none"), pages.startRequest());
      if (reason === "смена")
        await pages.save(request(), response(sessionB), pages.startRequest());
      for (const cache of [pages, new PwaPageCache(storage, origin)]) {
        const generation = cache.startRequest();
        const late = Promise.withResolvers<Response>();
        const saving = late.promise.then(async (value) => {
          await cache.observe(value.clone(), generation);
          await cache.save(request("/schedule"), value, generation);
        });
        late.resolve(response(sessionA));
        await saving;
        expect(await cache.read("/schedule")).toBeUndefined();
        expect(await storage.keys()).not.toContain(
          `${PAGE_CACHE_PREFIX}${sessionA}`,
        );
        expect(
          (await cache.read("/today"))?.headers.get("X-Pulse-Session"),
        ).toBe(reason === "смена" ? sessionB : undefined);
      }
    },
  );
  it("ранний API B после выхода не отбрасывает HTML B, включая после перезапуска", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    // An API can identify A before either HTML snapshot has been saved.
    await pages.observe(response(), pages.startRequest());
    await pages.clear();
    const restarted = new PwaPageCache(storage, origin);
    const generation = restarted.startRequest();
    await restarted.observe(response(sessionB), generation);
    await restarted.save(request(), response(sessionB), generation);
    await restarted.save(request("/schedule"), response(sessionA), generation);
    expect(
      (await restarted.read("/today"))?.headers.get("X-Pulse-Session"),
    ).toBe(sessionB);
    expect(await restarted.read("/schedule")).toBeUndefined();
  });
  it("очистка другим экземпляром не позволяет работающему SW восстановить A", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    await new PwaPageCache(storage, origin).clear();
    await pages.save(request(), response(), pages.startRequest());
    expect(await pages.read("/today")).toBeUndefined();
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("одновременные запись и очистка в разных экземплярах не теряют отзыв", async () => {
    const { storage } = memoryStorage();
    const opened = storage.open.bind(storage);
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let pause = true;
    vi.spyOn(storage, "open").mockImplementation(async (name) => {
      const cache = await opened(name);
      if (name === SESSION_STATE_CACHE) {
        const put = cache.put.bind(cache);
        vi.spyOn(cache, "put").mockImplementation(async (...args) => {
          if (pause) {
            pause = false;
            entered.resolve();
            await resume.promise;
          }
          return put(...args);
        });
      }
      return cache;
    });
    const pages = new PwaPageCache(storage, origin);
    const saving = pages.save(request(), response(), pages.startRequest());
    await entered.promise;
    const clearing = new PwaPageCache(storage, origin).clear();
    resume.resolve();
    await Promise.all([saving, clearing]);
    const restarted = new PwaPageCache(storage, origin);
    await restarted.save(request(), response(), restarted.startRequest());
    expect(await restarted.read("/today")).toBeUndefined();
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("обычный POST инвалидирует страницы, сохраняя возможность обновления текущей сессии", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    const oldGeneration = pages.startRequest();
    await pages.invalidate();
    await pages.save(request(), response(), oldGeneration);
    expect(await pages.read("/today")).toBeUndefined();
    const restarted = new PwaPageCache(storage, origin);
    await restarted.save(request(), response(), restarted.startRequest());
    expect(await restarted.read("/today")).toBeDefined();
    await restarted.clear();
    await restarted.save(request(), response(), restarted.startRequest());
    expect(await restarted.read("/today")).toBeUndefined();
  });
  it("смена известной сессии быстрым API отбрасывает поздний HTML прежнего студента", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    const generation = pages.startRequest();
    await pages.observe(response(sessionB), generation);
    await pages.save(request(), response(sessionA), generation);
    expect(await pages.read("/today")).toBeUndefined();
    await pages.save(request(), response(sessionB), pages.startRequest());
    expect(await pages.read("/today")).toBeDefined();
    expect(await storage.keys()).toEqual([
      SESSION_STATE_CACHE,
      `${PAGE_CACHE_PREFIX}${sessionB}`,
    ]);
  });
  it("ответ анонима или сотрудника очищает студенческие страницы", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    await pages.observe(response("none"), pages.startRequest());
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("ответ, пришедший после очистки, не восстанавливает прежнюю сессию", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    const generation = pages.startRequest();
    const clearing = pages.clear();
    await pages.observe(response(), generation);
    await clearing;
    await pages.save(request(), response(), generation);
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("две неоднозначные сессии после перезапуска удаляются", async () => {
    const { storage } = memoryStorage();
    await storage.open(`${PAGE_CACHE_PREFIX}${sessionA}`);
    await storage.open(`${PAGE_CACHE_PREFIX}${sessionB}`);
    const pages = new PwaPageCache(storage, origin);
    expect(await pages.read("/today")).toBeUndefined();
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("офлайн-метка содержит время сохранения и сохраняет исходную CSP и nonce", async () => {
    const saved = response(sessionA, {
      [SAVED_AT_HEADER]: "2026-11-04T12:00:00.000Z",
      "Content-Security-Policy": "script-src 'nonce-original'",
      "Content-Length": "123",
      "Content-Encoding": "gzip",
    });
    const offline = await offlineSnapshot(saved);
    expect(await offline?.text()).toContain(
      'data-pwa-saved-at="2026-11-04T12:00:00.000Z"',
    );
    expect(offline?.headers.get("Content-Security-Policy")).toBe(
      "script-src 'nonce-original'",
    );
    expect(offline?.headers.has("Content-Length")).toBe(false);
    expect(offline?.headers.has("Content-Encoding")).toBe(false);
  });
  it("повреждённое время не попадает в HTML", async () => {
    expect(
      await offlineSnapshot(
        response(sessionA, { [SAVED_AT_HEADER]: '"><script>' }),
      ),
    ).toBeUndefined();
  });
  it("максимальный возраст копии ограничен обычным сроком сессии", () => {
    expect(MAX_OFFLINE_AGE_MS).toBe(SESSION_TTL_MS);
  });
  it.each([0, 1])(
    "после expiresAt копия удаляется вместе с другим экраном, в том числе после перезапуска SW (%s)",
    async (extra) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
      const { storage } = memoryStorage();
      const pages = new PwaPageCache(storage, origin);
      await pages.save(
        request(),
        response(sessionA, {
          [SESSION_EXPIRES_HEADER]: new Date(Date.now() + 1000).toISOString(),
        }),
        pages.startRequest(),
      );
      await pages.save(request("/schedule"), response(), pages.startRequest());
      vi.setSystemTime(Date.now() + 1000 + extra);
      const restarted = new PwaPageCache(storage, origin);
      expect(await restarted.read("/today")).toBeUndefined();
      expect(await restarted.read("/schedule")).toBeUndefined();
      expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
    },
  );
  it("копия старше семи дней не выдаётся даже с более поздним expiresAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(
      request(),
      response(sessionA, {
        [SESSION_EXPIRES_HEADER]: new Date(
          Date.now() + MAX_OFFLINE_AGE_MS * 2,
        ).toISOString(),
      }),
      pages.startRequest(),
    );
    vi.setSystemTime(Date.now() + MAX_OFFLINE_AGE_MS);
    expect(await pages.read("/today")).toBeUndefined();
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it.each(["", "invalid", "2020-01-01T00:00:00Z"])(
    "не сохраняет ответ с отсутствующим, повреждённым или истёкшим expiresAt: %s",
    async (value) => {
      const { storage } = memoryStorage();
      const pages = new PwaPageCache(storage, origin);
      await pages.save(
        request(),
        response(sessionA, { [SESSION_EXPIRES_HEADER]: value }),
        pages.startRequest(),
      );
      expect(await pages.read("/today")).toBeUndefined();
    },
  );
  it("старая копия без expiresAt удаляется при первом офлайн-чтении", async () => {
    const { storage } = memoryStorage();
    const cache = await storage.open(`${PAGE_CACHE_PREFIX}${sessionA}`);
    const headers = new Headers(response().headers);
    headers.delete(SESSION_EXPIRES_HEADER);
    headers.set(SAVED_AT_HEADER, new Date().toISOString());
    await cache.put(
      `${origin}/today`,
      new Response("Старая копия", { headers }),
    );
    expect(
      await new PwaPageCache(storage, origin).read("/today"),
    ).toBeUndefined();
    expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
  });
  it("отказ Cache Storage при очистке не разрешает повторное чтение в текущем SW", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(), pages.startRequest());
    vi.spyOn(storage, "delete").mockRejectedValue(
      new Error("storage unavailable"),
    );
    await expect(pages.clear()).rejects.toThrow("storage unavailable");
    expect(await pages.read("/today")).toBeUndefined();
    const restarted = new PwaPageCache(storage, origin);
    expect(await restarted.read("/today")).toBeUndefined();
    await restarted.save(request(), response(), restarted.startRequest());
    expect(await restarted.read("/today")).toBeUndefined();
  });
});
