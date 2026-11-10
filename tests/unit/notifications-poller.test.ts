import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PulseDto } from "@/application/notifications/ports";
import { LivePulse } from "@/ui/notifications/live-pulse";
import {
  PulseHttpError,
  startPulsePolling,
} from "@/ui/notifications/pulse-poller";

const live = vi.hoisted(() => ({
  language: "ru",
  refresh: vi.fn(),
  toast: vi.fn(),
  useEffect: vi.fn<(effect: () => () => void) => void>(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: live.refresh }),
}));
vi.mock("react", () => ({ useEffect: live.useEffect }));
vi.mock("sonner", () => ({ toast: live.toast }));
vi.mock("@/ui/i18n/language-provider", () => ({
  useLanguage: () => live.language,
}));

let cleanup: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  live.language = "ru";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const initial: PulseDto = { unread: 1, latestAt: "2026-11-04T09:00:00.000Z" };

function mountLivePulse(
  pulse: PulseDto,
  latestTitle: Parameters<typeof LivePulse>[0]["latestTitle"],
) {
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const load = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => pulse,
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("fetch", load);
  LivePulse({ initial, latestTitle });
  const effect = live.useEffect.mock.lastCall?.[0];
  if (!effect) throw new Error("Эффект опроса не зарегистрирован.");
  cleanup = effect();
  return {
    load,
    setVisible(visible: boolean) {
      document.visibilityState = visible ? "visible" : "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

it.each([400, 401, 403, 429, 500, 503])(
  "LivePulse отменяет незавершённое тело HTTP %s до обработки ошибки",
  async (status) => {
    const { load } = mountLivePulse(initial, vi.fn());
    let finish: () => void = () => {};
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const response = new Response(new ReadableStream({ cancel }), { status });
    load.mockResolvedValue(response);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(true);
    expect(live.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(live.refresh).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    const stopped = status === 401 || status === 403;
    expect(vi.getTimerCount()).toBe(stopped ? 0 : 1);
    load.mockResolvedValue(Response.json(initial));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(stopped ? 2 : 3);
    expect(live.toast).not.toHaveBeenCalled();
  },
);

it("опрос видимой вкладки каждые 10 с, пауза в скрытой и немедленный запрос при возвращении", async () => {
  let visible = true;
  let listener = () => {};
  const unsubscribe = vi.fn();
  const load = vi.fn().mockResolvedValue(initial);
  const changed = vi.fn();
  const stop = startPulsePolling({
    initial,
    visible: () => visible,
    subscribe(fn) {
      listener = fn;
      return unsubscribe;
    },
    load,
    changed,
    unauthorized: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  visible = false;
  listener();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledTimes(2);
  visible = true;
  listener();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(3);
  expect(changed).not.toHaveBeenCalled();
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledTimes(3);
});

it.each([401, 403])(
  "ошибка отмены потока не мешает остановке при HTTP %s",
  async (status) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { load } = mountLivePulse(initial, vi.fn());
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error("Сбой потока");
        },
      }),
      { status },
    );
    load.mockResolvedValue(response);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(response.bodyUsed).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "PULSE_RESPONSE_CANCEL_FAILED",
    );
    expect(live.refresh).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("изменение latestAt или unread обновляет экран один раз", async () => {
  const next = { unread: 2, latestAt: "2026-11-04T10:00:00.000Z" };
  const changed = vi.fn().mockResolvedValue(undefined);
  const load = vi.fn().mockResolvedValue(next);
  const stop = startPulsePolling({
    initial,
    visible: () => true,
    subscribe: () => () => {},
    load,
    changed,
    unauthorized: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledExactlyOnceWith(next, initial);
  await vi.advanceTimersByTimeAsync(9999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(changed).toHaveBeenCalledTimes(1);
  load.mockResolvedValue({ ...next, unread: 0 });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
});

it("скрытие во время latestTitle сохраняет изменение: при возвращении один refresh и тост без повторов", async () => {
  const next = { unread: 2, latestAt: "2026-11-04T10:00:00.000Z" };
  const title = "Справка готова";
  let resolve: (result: { latestTitle: string | null }) => void = () => {};
  const latestTitle = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ latestTitle: string | null }>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ latestTitle: title });
  const { load, setVisible } = mountLivePulse(next, latestTitle);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  expect(latestTitle).toHaveBeenCalledExactlyOnceWith({
    latestAt: next.latestAt,
  });
  setVisible(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledOnce();
  resolve({ latestTitle: title });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(load).toHaveBeenCalledOnce();
  expect(live.refresh).not.toHaveBeenCalled();
  expect(live.toast).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);

  setVisible(true);
  setVisible(true);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(0);
  expect(latestTitle).toHaveBeenCalledTimes(2);
  expect(live.refresh).toHaveBeenCalledOnce();
  expect(live.toast).toHaveBeenCalledExactlyOnceWith(title);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledTimes(5);
  setVisible(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(5);
  setVisible(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(6);
  expect(latestTitle).toHaveBeenCalledTimes(2);
  expect(live.refresh).toHaveBeenCalledOnce();
  expect(live.toast).toHaveBeenCalledExactlyOnceWith(title);
});

it.each([
  { name: "отсутствует", result: () => Promise.resolve({ latestTitle: null }) },
  {
    name: "не загрузился",
    result: () => Promise.reject(new Error("Заголовок недоступен.")),
  },
])(
  "если заголовок $name, экран обновляется один раз без тоста",
  async ({ result }) => {
    const next = { unread: 2, latestAt: "2026-11-04T10:00:00.000Z" };
    const latestTitle = vi.fn(result);
    const { load } = mountLivePulse(next, latestTitle);
    await vi.advanceTimersByTimeAsync(0);
    expect(live.refresh).toHaveBeenCalledOnce();
    expect(live.toast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(4);
    expect(latestTitle).toHaveBeenCalledOnce();
    expect(live.refresh).toHaveBeenCalledOnce();
    expect(live.toast).not.toHaveBeenCalled();
  },
);

it("нет параллельных запросов; ответ скрытой/закрытой вкладки не обновляет UI", async () => {
  let resolve: (value: PulseDto) => void = () => {};
  const load = vi.fn(
    (_signal: AbortSignal) =>
      new Promise<PulseDto>((done) => {
        resolve = done;
      }),
  );
  let listener = () => {};
  let visible = true;
  const changed = vi.fn();
  const stop = startPulsePolling({
    initial,
    visible: () => visible,
    subscribe(fn) {
      listener = fn;
      return () => {};
    },
    load,
    changed,
    unauthorized: vi.fn(),
  });
  listener();
  listener();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledOnce();
  visible = false;
  listener();
  resolve({ unread: 2, latestAt: "2026-11-04T10:00:00.000Z" });
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).not.toHaveBeenCalled();
  visible = true;
  listener();
  expect(load).toHaveBeenCalledTimes(2);
  stop();
  expect(load.mock.calls[0]?.[0]?.aborted).toBe(true);
  resolve({ unread: 2, latestAt: "2026-11-04T10:00:00.000Z" });
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).not.toHaveBeenCalled();
});

it.each([401, 403])(
  "HTTP %s окончательно останавливает опрос, только 401 вызывает обновление layout один раз",
  async (status) => {
    let visible = true;
    let listener = () => {};
    const load = vi.fn((_signal: AbortSignal) =>
      Promise.reject(new PulseHttpError(status)),
    );
    const unauthorized = vi.fn();
    const unsubscribe = vi.fn();
    const changed = vi.fn();
    const stop = startPulsePolling({
      initial,
      visible: () => visible,
      subscribe(fn) {
        listener = fn;
        return unsubscribe;
      },
      load,
      changed,
      unauthorized,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]?.[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    visible = false;
    listener();
    visible = true;
    listener();
    listener();
    await vi.advanceTimersByTimeAsync(180_000);
    stop();
    expect(load).toHaveBeenCalledOnce();
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(changed).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  },
);

it.each([
  { name: "HTTP 500", error: new PulseHttpError(500) },
  { name: "ошибке сети", error: new TypeError("Сеть недоступна.") },
])(
  "при $name паузы растут 10→20→40→60 секунд и остаются на потолке",
  async ({ error }) => {
    const load = vi.fn().mockRejectedValue(error);
    const unauthorized = vi.fn();
    const stop = startPulsePolling({
      initial,
      visible: () => true,
      subscribe: () => () => {},
      load,
      changed: vi.fn(),
      unauthorized,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    for (const delay of [10_000, 20_000, 40_000, 60_000, 60_000]) {
      const calls = load.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(load).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(calls + 1);
    }
    expect(unauthorized).not.toHaveBeenCalled();
    stop();
  },
);

it("первый успешный ответ сбрасывает интервал и следующую последовательность ошибок до 10 секунд", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new PulseHttpError(503))
    .mockRejectedValueOnce(new TypeError("Сеть недоступна."))
    .mockResolvedValueOnce(initial)
    .mockRejectedValue(new PulseHttpError(500));
  const stop = startPulsePolling({
    initial,
    visible: () => true,
    subscribe: () => () => {},
    load,
    changed: vi.fn(),
    unauthorized: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledTimes(3);
  for (const [index, delay] of [10_000, 10_000, 20_000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(load).toHaveBeenCalledTimes(3 + index);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(4 + index);
  }
  stop();
});

it("во время backoff скрытая вкладка молчит, возвращение даёт один немедленный запрос без наложения", async () => {
  let visible = true;
  let listener = () => {};
  let reject: (error: unknown) => void = () => {};
  const load = vi
    .fn()
    .mockRejectedValueOnce(new PulseHttpError(500))
    .mockRejectedValueOnce(new TypeError("Сеть недоступна."))
    .mockImplementation(
      () =>
        new Promise<PulseDto>((_resolve, fail) => {
          reject = fail;
        }),
    );
  const stop = startPulsePolling({
    initial,
    visible: () => visible,
    subscribe(fn) {
      listener = fn;
      return () => {};
    },
    load,
    changed: vi.fn(),
    unauthorized: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(load).toHaveBeenCalledTimes(2);
  visible = false;
  listener();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(load).toHaveBeenCalledTimes(2);
  visible = true;
  listener();
  listener();
  expect(load).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(load).toHaveBeenCalledTimes(3);
  reject(new PulseHttpError(502));
  await vi.advanceTimersByTimeAsync(39_999);
  expect(load).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(4);
  stop();
  reject(new TypeError("Запрос отменён."));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(load).toHaveBeenCalledTimes(4);
});

it("поздний 401 после завершения эффекта не обновляет layout и не запускает таймер", async () => {
  let reject: (error: unknown) => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<PulseDto>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const unauthorized = vi.fn();
  const stop = startPulsePolling({
    initial,
    visible: () => true,
    subscribe: () => () => {},
    load,
    changed: vi.fn(),
    unauthorized,
  });
  stop();
  reject(new PulseHttpError(401));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(load).toHaveBeenCalledOnce();
  expect(unauthorized).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("английский тост сохраняет заголовок БД и добавляет пометку о русском тексте", async () => {
  live.language = "en";
  const next = { unread: 2, latestAt: "2026-11-04T10:00:00.000Z" };
  mountLivePulse(
    next,
    vi.fn().mockResolvedValue({ latestTitle: "Справка готова" }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(live.refresh).toHaveBeenCalledOnce();
  expect(live.toast).toHaveBeenCalledExactlyOnceWith("Справка готова", {
    description: "Notification content is available in Russian.",
  });
});
