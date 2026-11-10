import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearPushBeforeLogout } from "@/ui/notifications/push-logout";

const endpoint = "https://fcm.googleapis.com/fcm/send/logout-test";
let getRegistration: ReturnType<typeof vi.fn>;
let getSubscription: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let warning: ReturnType<typeof vi.spyOn>;
const origin = "https://pulse.example";
const registration = () => ({
  scope: `${origin}/`,
  active: { scriptURL: `${origin}/sw.js` },
  pushManager: { getSubscription },
});

beforeEach(() => {
  unsubscribe = vi.fn().mockResolvedValue(true);
  getSubscription = vi.fn().mockResolvedValue({ endpoint, unsubscribe });
  const current = registration();
  getRegistration = vi.fn().mockResolvedValue(current);
  fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ok: true }));
  warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration,
      ready: Promise.resolve(current),
      controller: current.active,
    },
  });
  vi.stubGlobal("window", { location: { origin } });
  vi.stubGlobal("fetch", fetcher);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("перед выходом удаляет серверную подписку, дочитывает ответ и отписывает браузер", async () => {
  const response = Response.json({ ok: true });
  fetcher.mockResolvedValue(response);
  unsubscribe.mockImplementation(async () => {
    expect(response.bodyUsed).toBe(true);
    return true;
  });
  await clearPushBeforeLogout();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "/api/push/subscription",
    expect.objectContaining({
      method: "DELETE",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      signal: expect.any(AbortSignal),
    }),
  );
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(warning).not.toHaveBeenCalled();
});

it.each([undefined, {}, { serviceWorker: {} }])(
  "без service worker выход не требует сети: %j",
  async (navigator) => {
    vi.stubGlobal("navigator", navigator);
    await clearPushBeforeLogout();
    expect(fetcher).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  },
);

it.each(["registration", "subscription"])(
  "при отсутствии %s выход не требует сети",
  async (missing) => {
    if (missing === "registration")
      getRegistration.mockResolvedValue(undefined);
    else getSubscription.mockResolvedValue(null);
    await clearPushBeforeLogout();
    expect(fetcher).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  },
);

it.each([404, 500])(
  "при ответе %i тело читается, браузер отписывается и ошибка не выходит наружу",
  async (status) => {
    const response = Response.json(
      { error: "private error details" },
      { status },
    );
    fetcher.mockResolvedValue(response);
    await expect(clearPushBeforeLogout()).resolves.toBeUndefined();
    expect(response.bodyUsed).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    if (status === 404) expect(warning).not.toHaveBeenCalled();
    else
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        "PUSH_LOGOUT_DELETE_FAILED",
      );
  },
);

it("ошибка сети не мешает отписке браузера и не раскрывает детали", async () => {
  fetcher.mockRejectedValue(new Error("private endpoint or cookie"));
  await expect(clearPushBeforeLogout()).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledExactlyOnceWith("PUSH_LOGOUT_DELETE_FAILED");
});

it.each(["registration", "subscription", "unsubscribe"])(
  "сбой %s не препятствует выходу",
  async (failed) => {
    const target = {
      registration: getRegistration,
      subscription: getSubscription,
      unsubscribe,
    }[failed];
    target?.mockRejectedValue(new Error("private details"));
    await expect(clearPushBeforeLogout()).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      failed === "unsubscribe"
        ? "PUSH_LOGOUT_UNSUBSCRIBE_FAILED"
        : "PUSH_LOGOUT_CLEANUP_FAILED",
    );
  },
);

it.each(["registration", "subscription"])(
  "дедлайн %s не допускает позднего DELETE после выхода",
  async (slow) => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<unknown>();
    if (slow === "registration")
      getRegistration.mockReturnValue(pending.promise);
    else getSubscription.mockReturnValue(pending.promise);
    const cleanup = clearPushBeforeLogout(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(cleanup).resolves.toBeUndefined();
    expect(unsubscribe).not.toHaveBeenCalled();
    pending.resolve(
      slow === "registration" ? registration() : { endpoint, unsubscribe },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
    if (slow === "subscription") expect(unsubscribe).toHaveBeenCalledOnce();
    else {
      expect(getSubscription).not.toHaveBeenCalled();
      expect(unsubscribe).not.toHaveBeenCalled();
    }
    expect(warning).toHaveBeenCalledExactlyOnceWith("PUSH_LOGOUT_TIMEOUT");
  },
);

it("дедлайн отменяет fetch, отписывает браузер и отменяет позднее тело ответа", async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<Response>();
  fetcher.mockReturnValue(pending.promise);
  const cleanup = clearPushBeforeLogout(2000);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(cleanup).resolves.toBeUndefined();
  const signal = fetcher.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
  const response = Response.json({ ok: true });
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(0);
  expect(response.bodyUsed).toBe(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledExactlyOnceWith("PUSH_LOGOUT_TIMEOUT");
});

it("зависшая отписка браузера ограничена общим дедлайном", async () => {
  vi.useFakeTimers();
  unsubscribe.mockReturnValue(new Promise(() => {}));
  const cleanup = clearPushBeforeLogout(2000);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(cleanup).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledExactlyOnceWith("PUSH_LOGOUT_TIMEOUT");
});
