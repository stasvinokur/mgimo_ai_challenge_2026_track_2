import { afterEach, expect, it, vi } from "vitest";
import { memoryStorage } from "./pwa-storage";

afterEach(() => vi.resetModules());

it.each(["", "/dekanat"])(
  "PWA: изоляция папки, HTML, выход и смена сессии %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", base);
    vi.resetModules();
    const pwa = await import("@/ui/shell/pwa-cache");
    const origin = "https://pulse.example";
    const request = (path: string, headers = {}) =>
      new Request(`${origin}${path}`, {
        headers: { Accept: "text/html", ...headers },
      });
    expect(pwa.isPageSnapshot(request(`${base}/today`), origin)).toBe(true);
    expect(pwa.isPageSnapshot(request(`${base}/schedule`), origin)).toBe(true);
    expect(
      pwa.isPageSnapshot(request(`${base}/today`, { RSC: "1" }), origin),
    ).toBe(false);
    expect(pwa.isPageSnapshot(request(`${base}/api/me/pulse`), origin)).toBe(
      false,
    );
    expect(pwa.isPageSnapshot(request("/other/today"), origin)).toBe(false);
    if (base) expect(pwa.isPageSnapshot(request("/today"), origin)).toBe(false);
    expect(
      pwa.endsPageSession(Response.redirect(`${origin}${base}/login`), origin),
    ).toBe(true);
    const storage = memoryStorage().storage;
    const neighbor = "pulse-pages-neighbor-v1-build-a";
    await storage.open(neighbor);
    const pages = new pwa.PwaPageCache(storage, origin, "build");
    const response = (session: string) =>
      new Response("<html>Учебная страница</html>", {
        headers: {
          "Content-Type": "text/html",
          "X-Pulse-Cacheable": "1",
          "X-Pulse-Session": session.repeat(64),
          [pwa.SESSION_EXPIRES_HEADER]: new Date(
            Date.now() + 60_000,
          ).toISOString(),
        },
      });
    const old = pages.startRequest();
    await pages.save(request(`${base}/today`), response("a"), old);
    expect(await pages.read(`${base}/today`)).toBeDefined();
    await pages.observe(response("b"), pages.startRequest());
    await pages.save(request(`${base}/today`), response("a"), old);
    expect(await pages.read(`${base}/today`)).toBeUndefined();
    await pages.save(
      request(`${base}/schedule`),
      response("b"),
      pages.startRequest(),
    );
    await pages.clear();
    expect(await pages.read(`${base}/schedule`)).toBeUndefined();
    expect(
      (await storage.keys()).filter((name) =>
        name.startsWith(pwa.PAGE_CACHE_PREFIX),
      ),
    ).toEqual([]);
    expect(await storage.keys()).toContain(neighbor);
  },
);
