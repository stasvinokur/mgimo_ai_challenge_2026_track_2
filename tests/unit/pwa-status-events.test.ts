import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  setSnapshot: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => undefined | (() => void)) => {
    hooks.effects.push(effect);
  },
  useState: () => [null, hooks.setSnapshot],
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/schedule" }));

import { PwaStatus } from "@/ui/shell/pwa-status";

const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  hooks.effects = [];
  hooks.setSnapshot.mockClear();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount({
  hasSnapshot = true,
  reason = "offline",
  online = false,
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(freshHTML()),
}: {
  hasSnapshot?: boolean;
  reason?: "offline" | "slow";
  online?: boolean;
  fetcher?: ReturnType<typeof vi.fn<typeof fetch>>;
} = {}) {
  const savedAt = "2026-11-04T12:00:00.000Z";
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), {
    documentElement: {
      dataset: hasSnapshot
        ? { pwaSavedAt: savedAt, pwaSnapshotReason: reason }
        : {},
    },
    visibilityState: "visible",
  });
  const worker = { scriptURL: "https://pulse.example/sw.js" };
  const registration = { scope: "https://pulse.example/", active: worker };
  const workerEvents = Object.assign(new EventTarget(), {
    ready: Promise.resolve(registration),
    getRegistration: vi.fn().mockResolvedValue(registration),
    controller: worker,
  });
  const navigatorState = { onLine: online, serviceWorker: workerEvents };
  const locationState = {
    origin: "https://pulse.example",
    pathname: "/schedule",
    search: "",
    assign: vi.fn<(url: string) => void>(),
    reload: vi.fn(),
  };
  class Link {
    href = "https://pulse.example/today";
    target = "";
    closest() {
      return this;
    }
    hasAttribute() {
      return false;
    }
  }
  vi.stubGlobal("window", windowEvents);
  vi.stubGlobal("document", documentEvents);
  vi.stubGlobal("navigator", navigatorState);
  vi.stubGlobal("location", locationState);
  vi.stubGlobal("Element", Link);
  vi.stubGlobal("fetch", fetcher);
  const listeners = [windowEvents, documentEvents, workerEvents].map(
    (target) => ({
      add: vi.spyOn(target, "addEventListener"),
      remove: vi.spyOn(target, "removeEventListener"),
    }),
  );

  renderToStaticMarkup(createElement(PwaStatus));
  const cleanup = hooks.effects.at(-1)?.();
  if (!cleanup) throw new Error("Обработчики статуса PWA не установлены.");
  cleanups.push(cleanup);
  hooks.setSnapshot.mockClear();

  function click() {
    const event = Object.assign(new Event("click", { cancelable: true }), {
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
    Object.defineProperty(event, "target", { value: new Link() });
    documentEvents.dispatchEvent(event);
    return event;
  }

  return {
    windowEvents,
    documentEvents,
    navigatorState,
    locationState,
    listeners,
    cleanup,
    click,
    fetcher,
  };
}

function freshHTML() {
  return new Response("<html>Свежая страница</html>", {
    headers: { "Content-Type": "text/html" },
  });
}

it("повторная копия после раннего online обновляется по свежему прогреву без второго события", async () => {
  const network = Promise.withResolvers<Response>();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(network.promise);
  const { locationState } = mount({ online: true, fetcher });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(locationState.reload).not.toHaveBeenCalled();
  network.resolve(freshHTML());
  await vi.advanceTimersByTimeAsync(0);
  expect(locationState.reload).toHaveBeenCalledOnce();
});

it("ложное online без сети не перезагружает копию и не скрывает её плашку", async () => {
  const { windowEvents, locationState, fetcher } = mount();
  windowEvents.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(5000);
  expect(locationState.reload).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(hooks.setSnapshot).not.toHaveBeenCalled();
});

it.each(["offline", "slow"] as const)(
  "настоящий возврат сети обновляет копию %s один раз",
  async (reason) => {
    const { windowEvents, navigatorState, locationState, fetcher } = mount({
      reason,
    });
    navigatorState.onLine = true;
    windowEvents.dispatchEvent(new Event("online"));
    windowEvents.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(locationState.reload).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(hooks.setSnapshot).not.toHaveBeenCalled();
  },
);

it("обычная страница снимает офлайн-статус без перезагрузки", () => {
  const { windowEvents, navigatorState, locationState } = mount({
    hasSnapshot: false,
  });
  navigatorState.onLine = true;
  windowEvents.dispatchEvent(new Event("online"));
  expect(locationState.reload).not.toHaveBeenCalled();
  expect(hooks.setSnapshot).toHaveBeenCalledExactlyOnceWith(null);
});

it("скрытая копия не перезагружается по возвращению сети", () => {
  const { windowEvents, documentEvents, navigatorState, locationState } =
    mount();
  documentEvents.visibilityState = "hidden";
  navigatorState.onLine = true;
  windowEvents.dispatchEvent(new Event("online"));
  expect(locationState.reload).not.toHaveBeenCalled();
  expect(hooks.setSnapshot).not.toHaveBeenCalled();
});

it("уход отмечен до location.assign и защищает переход от настоящего online", () => {
  const { windowEvents, navigatorState, locationState, click } = mount();
  locationState.assign.mockImplementation(() => {
    navigatorState.onLine = true;
    windowEvents.dispatchEvent(new Event("online"));
  });
  expect(click().defaultPrevented).toBe(true);
  expect(locationState.assign).toHaveBeenCalledExactlyOnceWith(
    "https://pulse.example/today",
  );
  expect(locationState.reload).not.toHaveBeenCalled();
  expect(hooks.setSnapshot).not.toHaveBeenCalled();
});

it.each(["beforeunload", "pagehide"])(
  "%s защищает уходящий документ от настоящего online",
  (event) => {
    const { windowEvents, navigatorState, locationState } = mount();
    windowEvents.dispatchEvent(new Event(event));
    navigatorState.onLine = true;
    windowEvents.dispatchEvent(new Event("online"));
    expect(locationState.reload).not.toHaveBeenCalled();
    expect(hooks.setSnapshot).not.toHaveBeenCalled();
  },
);

it("возврат документа из BFCache снова разрешает обновить копию", async () => {
  const { windowEvents, navigatorState, locationState } = mount();
  windowEvents.dispatchEvent(new Event("pagehide"));
  navigatorState.onLine = true;
  windowEvents.dispatchEvent(new Event("online"));
  expect(locationState.reload).not.toHaveBeenCalled();
  windowEvents.dispatchEvent(
    Object.assign(new Event("pageshow"), { persisted: true }),
  );
  windowEvents.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(locationState.reload).toHaveBeenCalledOnce();
});

it.each(["offline", "slow"] as const)(
  "online раньше готовности SW: ответ-копия %s не перезагружает документ, следующий свежий ответ восстанавливает его",
  async (reason) => {
    const cached = freshHTML();
    cached.headers.set("X-Pulse-Saved-At", "2026-11-04T12:00:00.000Z");
    const network = Promise.withResolvers<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cached)
      .mockReturnValueOnce(network.promise);
    const { windowEvents, navigatorState, locationState } = mount({
      reason,
      fetcher,
    });
    navigatorState.onLine = true;
    windowEvents.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(locationState.reload).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(locationState.reload).not.toHaveBeenCalled();
    network.resolve(freshHTML());
    await vi.advanceTimersByTimeAsync(5000);
    expect(locationState.reload).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(["hidden", "beforeunload", "pagehide", "click", "cleanup"])(
  "поздний свежий ответ после %s не перезагружает копию и не оставляет повторов",
  async (event) => {
    const network = Promise.withResolvers<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(network.promise);
    const state = mount({ online: true, fetcher });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledOnce();
    if (event === "hidden") {
      state.documentEvents.visibilityState = "hidden";
      state.documentEvents.dispatchEvent(new Event("visibilitychange"));
    } else if (event === "click") {
      expect(state.click().defaultPrevented).toBe(false);
      expect(state.locationState.assign).not.toHaveBeenCalled();
    } else if (event === "cleanup") state.cleanup();
    else state.windowEvents.dispatchEvent(new Event(event));
    network.resolve(freshHTML());
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.locationState.reload).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(["hidden", "beforeunload", "pagehide", "click", "cleanup"])(
  "%s отменяет уже запланированный повтор прогрева",
  async (event) => {
    const cached = freshHTML();
    cached.headers.set("X-Pulse-Saved-At", "2026-11-04T12:00:00.000Z");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(cached);
    const state = mount({ online: true, fetcher });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    if (event === "hidden") {
      state.documentEvents.visibilityState = "hidden";
      state.documentEvents.dispatchEvent(new Event("visibilitychange"));
    } else if (event === "click") state.click();
    else if (event === "cleanup") state.cleanup();
    else state.windowEvents.dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(state.locationState.reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("online до navigator.onLine не обновляет документ без сети, но позднее замечает сеть без второго события", async () => {
  const { windowEvents, navigatorState, locationState, fetcher } = mount();
  windowEvents.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).not.toHaveBeenCalled();
  expect(locationState.reload).not.toHaveBeenCalled();
  navigatorState.onLine = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(locationState.reload).toHaveBeenCalledOnce();
});

it("потеря сети во время прогрева отклоняет поздний свежий ответ; после восстановления проверяет заново", async () => {
  const network = Promise.withResolvers<Response>();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(network.promise)
    .mockResolvedValueOnce(freshHTML());
  const { windowEvents, navigatorState, locationState } = mount({
    online: true,
    fetcher,
  });
  await vi.advanceTimersByTimeAsync(0);
  navigatorState.onLine = false;
  windowEvents.dispatchEvent(new Event("offline"));
  network.resolve(freshHTML());
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(locationState.reload).not.toHaveBeenCalled();
  navigatorState.onLine = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(locationState.reload).toHaveBeenCalledOnce();
});

it("копия на скрытой вкладке восстанавливается при показе без нового online", async () => {
  const { documentEvents, navigatorState, locationState, windowEvents } =
    mount();
  documentEvents.visibilityState = "hidden";
  navigatorState.onLine = true;
  windowEvents.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(locationState.reload).not.toHaveBeenCalled();
  documentEvents.visibilityState = "visible";
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(locationState.reload).toHaveBeenCalledOnce();
});

it("сбой прогрева сохраняет копию, диагностируется и повторяется без второго online", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(freshHTML());
  const { locationState } = mount({ online: true, fetcher });
  await vi.advanceTimersByTimeAsync(0);
  expect(warning).toHaveBeenCalledExactlyOnceWith("PWA_SNAPSHOT_WARM_FAILED");
  expect(locationState.reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(locationState.reload).toHaveBeenCalledOnce();
});

it("cleanup снимает все установленные обработчики", () => {
  const {
    windowEvents,
    navigatorState,
    locationState,
    listeners,
    cleanup,
    click,
  } = mount();
  cleanup();
  for (const { add, remove } of listeners) {
    for (const call of add.mock.calls) {
      expect(remove).toHaveBeenCalledWith(...call);
    }
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  }
  expect(click().defaultPrevented).toBe(false);
  navigatorState.onLine = true;
  windowEvents.dispatchEvent(new Event("online"));
  windowEvents.dispatchEvent(new Event("offline"));
  expect(locationState.assign).not.toHaveBeenCalled();
  expect(locationState.reload).not.toHaveBeenCalled();
  expect(hooks.setSnapshot).not.toHaveBeenCalled();
});
