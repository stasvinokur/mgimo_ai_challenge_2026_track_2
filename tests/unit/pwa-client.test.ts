import { afterEach, expect, it, vi } from "vitest";
import { PwaPageCache } from "@/ui/shell/pwa-cache";
import {
  clearPwaPages,
  warmPwaPage,
  watchPwaInstallation,
} from "@/ui/shell/pwa-client";
import { memoryStorage } from "./pwa-storage";

afterEach(() => vi.unstubAllGlobals());
it.each([200, 503])(
  "прогрев дочитывает все части тела ответа %s",
  async (status) => {
    let chunks = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(`chunk ${++chunks}`));
          if (chunks === 3) controller.close();
        },
      }),
      { status },
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    await warmPwaPage("/schedule?week=next");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/schedule?week=next", {
      headers: { Accept: "text/html" },
      cache: "no-store",
    });
    expect(response.bodyUsed).toBe(true);
    expect(chunks).toBe(3);
  },
);

it("прогрев ожидает конец потока, а не только получение заголовков", async () => {
  const finish = Promise.withResolvers<void>();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        await finish.promise;
        controller.enqueue(new TextEncoder().encode("HTML"));
        controller.close();
      },
    }),
  );
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
  let settled = false;
  const warming = warmPwaPage("/today").then(() => {
    settled = true;
  });
  try {
    await vi.waitFor(() => expect(response.bodyUsed).toBe(true));
    expect(settled).toBe(false);
  } finally {
    finish.resolve();
    await warming;
  }
  expect(settled).toBe(true);
});

it.each(["fetch", "body"])(
  "ошибка %s передаётся обработчику прогрева",
  async (source) => {
    const failure = new Error("test failure");
    const fetcher = vi.fn<typeof fetch>();
    if (source === "fetch") fetcher.mockRejectedValue(failure);
    else
      fetcher.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(failure);
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(warmPwaPage("/today")).rejects.toBe(failure);
  },
);

it.each([
  { status: 200, type: "text/html; charset=utf-8", saved: false, fresh: true },
  { status: 200, type: "text/html", saved: true, fresh: false },
  { status: 503, type: "text/html", saved: false, fresh: false },
  { status: 200, type: "application/json", saved: false, fresh: false },
  { status: 200, type: "text/x-component", saved: false, fresh: false },
])(
  "прогрев подтверждает свежий HTML: $status $type копия=$saved → $fresh",
  async ({ status, type, saved, fresh }) => {
    const response = new Response("Ответ", {
      status,
      headers: {
        "Content-Type": type,
        ...(saved ? { "X-Pulse-Saved-At": "2026-11-04T12:00:00.000Z" } : {}),
      },
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(await warmPwaPage("/today")).toBe(fresh);
    expect(response.bodyUsed).toBe(true);
  },
);

it("очистка без контроллера сохраняет отзыв отпечатка для следующего SW", async () => {
  const origin = "https://pulse.example";
  const { storage } = memoryStorage();
  const pages = new PwaPageCache(storage, origin);
  const request = new Request(`${origin}/today`, {
    headers: { Accept: "text/html" },
  });
  const response = () =>
    new Response("HTML A", {
      headers: {
        "Content-Type": "text/html",
        "X-Pulse-Cacheable": "1",
        "X-Pulse-Session": "a".repeat(64),
        "X-Pulse-Session-Expires-At": new Date(
          Date.now() + 60_000,
        ).toISOString(),
      },
    });
  await pages.save(request, response(), pages.startRequest());
  vi.stubGlobal("window", { caches: storage, location: { origin } });
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("navigator", {
    locks: navigator.locks,
    serviceWorker: {
      controller: null,
      getRegistration: async () => undefined,
      ready: new Promise<ServiceWorkerRegistration>(() => {}),
    },
  });
  await clearPwaPages();
  const restarted = new PwaPageCache(storage, origin);
  await restarted.save(request, response(), restarted.startRequest());
  expect(await restarted.read("/today")).toBeUndefined();
});
it("ошибка install диагностируется фиксированным кодом без исходной ошибки", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const registration = Object.assign(new EventTarget(), { installing: worker });
  const stop = watchPwaInstallation(
    registration as unknown as ServiceWorkerRegistration,
  );
  worker.state = "redundant";
  worker.dispatchEvent(new Event("statechange"));
  expect(warning).toHaveBeenCalledExactlyOnceWith("PWA_SW_INSTALL_FAILED");
  stop();
});
it("слежение замечает провал следующего install, но не замену уже активированного worker", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const registration = Object.assign(new EventTarget(), {
    installing: null as null | typeof worker,
    active: Object.assign(new EventTarget(), { state: "activated" }),
  });
  const stop = watchPwaInstallation(
    registration as unknown as ServiceWorkerRegistration,
  );
  registration.installing = worker;
  registration.dispatchEvent(new Event("updatefound"));
  worker.state = "activated";
  worker.dispatchEvent(new Event("statechange"));
  worker.state = "redundant";
  worker.dispatchEvent(new Event("statechange"));
  expect(warning).not.toHaveBeenCalled();
  stop();
});
it("пустая регистрация после быстрого отказа install также диагностируется", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const registration = Object.assign(new EventTarget(), {
    installing: null,
    active: null,
    waiting: null,
  });
  watchPwaInstallation(registration as unknown as ServiceWorkerRegistration)();
  expect(warning).toHaveBeenCalledExactlyOnceWith("PWA_SW_INSTALL_FAILED");
});
