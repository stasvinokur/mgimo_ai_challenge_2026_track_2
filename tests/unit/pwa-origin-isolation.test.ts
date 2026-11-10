import { afterEach, expect, it, vi } from "vitest";
import { clearPushBeforeLogout } from "@/ui/notifications/push-logout";
import { PwaPageCache } from "@/ui/shell/pwa-cache";
import { clearPwaPages } from "@/ui/shell/pwa-client";
import {
  clearLegacyRootCaches,
  updateLegacyRootWorker,
} from "@/ui/shell/pwa-legacy";
import {
  isPulseWorker,
  ownPwaRegistration,
  readyPwaRegistration,
} from "@/ui/shell/pwa-scope";
import { memoryStorage } from "./pwa-storage";

const origin = "https://pulse.example";
const worker = (path: string) => ({
  scriptURL: `${origin}${path}`,
  postMessage: vi.fn(),
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["", "/dekanat", "/v1"])(
  "миграция кэшей удаляет только перечисленные имена и только из папки %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", base);
    const { storage } = memoryStorage();
    const legacy = [
      "pulse-pages-v1-a",
      "pulse-pages-v1-build-session",
      "pulse-session-state-v1",
      `serwist-precache-v2-${origin}/`,
      `serwist-runtime-${origin}/`,
    ];
    const keep = [
      `pulse-pages${base.replace("/", "-")}-v1-build-session`,
      `pulse-session-state-v1${base.replace("/", "-")}`,
      "neighbor-cache",
      "pulse-session-state-v1-other",
      `serwist-precache-v2-${origin}/dekanat/`,
      `serwist-precache-v2-${origin}/neighbor/`,
      "serwist-precache-v2-https://other.example/",
    ];
    for (const name of [...legacy, ...keep]) await storage.open(name);
    await clearLegacyRootCaches(storage, origin);
    expect((await storage.keys()).sort()).toEqual(
      [...new Set(base ? keep : [...legacy, ...keep])].sort(),
    );
  },
);

it("обновляет только старую корневую регистрацию /sw.js, соседнюю не снимает", async () => {
  vi.stubEnv("BASE_PATH", "/dekanat");
  const registration = (scope: string, script: string) => ({
    scope: `${origin}${scope}`,
    active: worker(script),
    update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn(),
  });
  const legacy = registration("/", "/sw.js");
  const neighbor = registration("/", "/neighbor/sw.js");
  const own = registration("/dekanat/", "/dekanat/sw.js");
  const prefix = registration("/another/", "/sw.js");
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: async () => [legacy, neighbor, own, prefix],
    },
  });
  await updateLegacyRootWorker(origin);
  expect(legacy.update).toHaveBeenCalledOnce();
  for (const r of [neighbor, own, prefix])
    expect(r.update).not.toHaveBeenCalled();
  for (const r of [legacy, neighbor, own, prefix])
    expect(r.unregister).not.toHaveBeenCalled();
  vi.stubEnv("BASE_PATH", "");
  await updateLegacyRootWorker(origin);
  expect(legacy.update).toHaveBeenCalledOnce();
});

it("сосед с корневым scope не получает подписку, ready или сообщение выхода", async () => {
  vi.stubEnv("BASE_PATH", "/dekanat");
  const foreign = worker("/neighbor/sw.js");
  const unsubscribe = vi.fn();
  const getSubscription = vi.fn().mockResolvedValue({ unsubscribe });
  const registration = {
    scope: `${origin}/`,
    active: foreign,
    pushManager: { getSubscription },
  };
  const getRegistration = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration,
      ready: Promise.resolve(registration),
      controller: foreign,
    },
  });
  vi.stubGlobal("window", { location: { origin } });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await ownPwaRegistration(origin)).toBeUndefined();
  expect(await readyPwaRegistration(origin)).toBeUndefined();
  expect(isPulseWorker(foreign as unknown as ServiceWorker, origin)).toBe(
    false,
  );
  await clearPushBeforeLogout();
  await clearPwaPages();
  expect(getRegistration).toHaveBeenCalledWith("/dekanat/");
  expect(getSubscription).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(foreign.postMessage).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["ack", "timeout"])(
  "страница очищает свой кэш в finally при ошибке контроллера: %s",
  async (failure) => {
    vi.useFakeTimers();
    vi.stubEnv("BASE_PATH", "/dekanat");
    const clear = vi
      .spyOn(PwaPageCache.prototype, "clear")
      .mockResolvedValue(undefined);
    const own = worker("/dekanat/sw.js");
    own.postMessage.mockImplementation((_message, ports: MessagePort[]) => {
      if (failure === "ack") ports[0]?.postMessage({ ok: false });
      ports[0]?.close();
    });
    const registration = { scope: `${origin}/dekanat/`, active: own };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: own,
        getRegistration: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
    vi.stubGlobal("window", {
      location: { origin },
      caches: memoryStorage().storage,
    });
    const result = clearPwaPages().then(
      () => null,
      (error: unknown) => error,
    );
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBeInstanceOf(Error);
    expect(((await result) as Error).message).toContain("Не удалось очистить");
    expect(clear).toHaveBeenCalledOnce();
  },
);

it("own ready требует scope и путь скрипта; query версии остаётся своим", async () => {
  vi.stubEnv("BASE_PATH", "/dekanat");
  const own = worker("/dekanat/sw.js?build=2");
  const registration = { scope: `${origin}/dekanat/`, active: own };
  const serviceWorker = {
    getRegistration: async () => registration,
    ready: Promise.resolve(registration),
    controller: own,
  };
  vi.stubGlobal("navigator", { serviceWorker });
  expect(await readyPwaRegistration(origin)).toBe(registration);
  registration.active = worker("/neighbor/sw.js");
  serviceWorker.controller = registration.active;
  expect(await readyPwaRegistration(origin)).toBeUndefined();
});
