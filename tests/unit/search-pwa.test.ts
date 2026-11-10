import { afterEach, expect, it, vi } from "vitest";
import { isPageSnapshot, PAGE_CACHE_PREFIX } from "@/ui/shell/pwa-cache";
import { memoryStorage } from "./pwa-storage";

const worker = vi.hoisted(() => ({
  handler: null as unknown as (input: {
    request: Request;
    url: URL;
    event: { waitUntil(promise: Promise<unknown>): void };
  }) => Promise<Response>,
}));
vi.mock("serwist", () => ({
  Serwist: class {
    constructor(options: {
      runtimeCaching: { handler: typeof worker.handler }[];
    }) {
      worker.handler = options.runtimeCaching[0]
        ?.handler as typeof worker.handler;
    }
    addEventListeners() {}
  },
}));
afterEach(() => vi.unstubAllGlobals());

it("реальный обработчик SW получает подсказки из сети и не хранит их даже с заголовками снимка", async () => {
  const origin = "https://pulse.example";
  const { storage, data } = memoryStorage();
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("self", {
    location: { origin },
    __SW_MANIFEST: [],
    __PULSE_BUILD_ID: "search-test",
    setTimeout,
    clearTimeout,
    addEventListener() {},
  });
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  await import("@/ui/shell/pwa-worker");
  const headers = {
    "X-Pulse-Cacheable": "1",
    "X-Pulse-Session": "a".repeat(64),
    "X-Pulse-Session-Expires-At": new Date(
      Date.now() + 86_400_000,
    ).toISOString(),
    "Cache-Control": "private, no-store",
  };
  async function run(path: string) {
    const request = new Request(`${origin}${path}`, {
      headers: { Accept: "text/html, application/json" },
    });
    const pending: Promise<unknown>[] = [];
    const response = await worker.handler({
      request,
      url: new URL(request.url),
      event: {
        waitUntil: (promise) => {
          pending.push(promise);
        },
      },
    });
    await Promise.all(pending);
    return response;
  }
  fetcher.mockResolvedValueOnce(
    new Response("Сегодня", {
      headers: { ...headers, "Content-Type": "text/html" },
    }),
  );
  await (await run("/today")).text();
  for (const query of ["геогр", "геогр"]) {
    const request = new Request(`${origin}/api/search/suggest?q=${query}`, {
      headers: { Accept: "text/html" },
    });
    expect(isPageSnapshot(request, origin)).toBe(false);
    fetcher.mockResolvedValueOnce(
      Response.json({ query, groups: [] }, { headers }),
    );
    expect(await (await run(`/api/search/suggest?q=${query}`)).json()).toEqual({
      query,
      groups: [],
    });
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
  const caches = await storage.keys();
  expect(caches.some((key) => key.startsWith(PAGE_CACHE_PREFIX))).toBe(true);
  for (const entries of data.values()) {
    for (const [url, response] of entries) {
      expect(url).not.toContain("/api/search/suggest");
      expect(await response.clone().text()).not.toContain("геогр");
    }
  }
  fetcher.mockRejectedValue(new Error("offline"));
  expect((await run("/api/search/suggest?q=геогр")).type).toBe("error");
});
