import { afterEach, expect, it, vi } from "vitest";
import { settleProfileAnchor } from "@/ui/onboarding/profile-anchor";

function environment(pending: string[] = []) {
  const listeners = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  const waiting = new Set(pending);
  let nextFrame = 0;
  const observers: Observer[] = [];
  class Observer {
    active = false;
    constructor(readonly callback: MutationCallback) {
      observers.push(this);
    }
    observe = vi.fn(() => {
      this.active = true;
    });
    disconnect = vi.fn(() => {
      this.active = false;
    });
  }
  const location = { hash: "#push-notifications" };
  const container = {
    matches: () => false,
    querySelector: vi.fn(() => (waiting.size ? {} : null)),
  };
  const scrollIntoView = vi.fn();
  const target = {
    id: "push-notifications",
    isConnected: true,
    closest: vi.fn<() => typeof container | null>(() => container),
    matches: () => waiting.has("push"),
    querySelector: container.querySelector,
    scrollIntoView,
  };
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal("window", {
    location,
    scrollY: 1500,
    addEventListener: listeners.addEventListener.bind(listeners),
    removeEventListener: listeners.removeEventListener.bind(listeners),
    requestAnimationFrame,
    cancelAnimationFrame,
    MutationObserver: Observer,
  });
  vi.stubGlobal("MutationObserver", Observer);
  return {
    target,
    container,
    location,
    frames,
    observers,
    scrollIntoView,
    start: () => settleProfileAnchor(target as unknown as HTMLElement),
    event: (name: string) => listeners.dispatchEvent(new Event(name)),
    mutation() {
      for (const observer of observers)
        if (observer.active)
          observer.callback([], observer as unknown as MutationObserver);
    },
    ready(id: string) {
      waiting.delete(id);
      this.mutation();
    },
    loading(id: string) {
      waiting.add(id);
      this.mutation();
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it("появившаяся цель доводится до якоря независимо от старой прокрутки Next", () => {
  const dom = environment();
  const cleanup = dom.start();
  expect(dom.scrollIntoView).not.toHaveBeenCalled();
  dom.frame();
  expect(dom.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
    block: "start",
    inline: "nearest",
    behavior: "instant",
  });
  dom.mutation();
  dom.frame();
  expect(dom.scrollIntoView).toHaveBeenCalledOnce();
  expect(dom.observers.every((observer) => !observer.active)).toBe(true);
  cleanup();
});

it.each([
  ["push", "passkeys"],
  ["passkeys", "push"],
])("ждёт обе карточки при порядке готовности %s → %s", (first, second) => {
  const dom = environment(["push", "passkeys"]);
  const cleanup = dom.start();
  expect(dom.container.querySelector).toHaveBeenCalledWith(
    '[data-profile-anchor-ready="false"]',
  );
  expect(dom.frames.size).toBe(0);
  dom.ready(first);
  dom.frame();
  expect(dom.scrollIntoView).not.toHaveBeenCalled();
  dom.ready(second);
  dom.mutation();
  expect(dom.frames.size).toBe(1);
  dom.frame();
  dom.mutation();
  dom.frame();
  expect(dom.scrollIntoView).toHaveBeenCalledOnce();
  cleanup();
});

it("перед кадром повторно проверяет готовность и ждёт новую загрузку", () => {
  const dom = environment();
  const cleanup = dom.start();
  dom.loading("passkeys");
  dom.frame();
  expect(dom.scrollIntoView).not.toHaveBeenCalled();
  dom.ready("passkeys");
  dom.frame();
  expect(dom.scrollIntoView).toHaveBeenCalledOnce();
  cleanup();
});

it("без внешнего контейнера проверяет готовность самой карточки", () => {
  const dom = environment(["push"]);
  dom.target.closest.mockReturnValue(null);
  dom.container.querySelector.mockImplementation(() => null);
  const cleanup = dom.start();
  dom.frame();
  expect(dom.scrollIntoView).not.toHaveBeenCalled();
  dom.ready("push");
  dom.frame();
  expect(dom.scrollIntoView).toHaveBeenCalledOnce();
  cleanup();
});

it.each([
  "wheel",
  "touchstart",
  "pointerdown",
  "keydown",
  "hashchange",
  "popstate",
])("событие %s отменяет уже запланированную прокрутку", (event) => {
  const dom = environment();
  const cleanup = dom.start();
  expect(dom.frames.size).toBe(1);
  dom.event(event);
  dom.frame();
  dom.mutation();
  dom.frame();
  expect(dom.scrollIntoView).not.toHaveBeenCalled();
  expect(dom.observers.every((observer) => !observer.active)).toBe(true);
  cleanup();
});

it("действие пользователя во время загрузки исключает позднюю прокрутку", () => {
  const dom = environment(["push", "passkeys"]);
  const cleanup = dom.start();
  dom.event("wheel");
  dom.ready("push");
  dom.ready("passkeys");
  dom.frame();
  expect(dom.scrollIntoView).not.toHaveBeenCalled();
  cleanup();
});

it("обычный scroll не отменяет восстановление якоря после загрузки", () => {
  const dom = environment(["push"]);
  const cleanup = dom.start();
  dom.event("scroll");
  dom.ready("push");
  dom.frame();
  expect(dom.scrollIntoView).toHaveBeenCalledOnce();
  cleanup();
});

it.each(["unmount", "disconnected", "hash"])(
  "%s между планированием и кадром исключает прокрутку",
  (cause) => {
    const dom = environment();
    const cleanup = dom.start();
    if (cause === "unmount") cleanup();
    if (cause === "disconnected") dom.target.isConnected = false;
    if (cause === "hash") dom.location.hash = "#passkeys";
    dom.frame();
    expect(dom.scrollIntoView).not.toHaveBeenCalled();
    cleanup();
  },
);

it.each(["", "#passkeys"])(
  "чужой или отсутствующий hash %j не начинает восстановление",
  (hash) => {
    const dom = environment();
    dom.location.hash = hash;
    const cleanup = dom.start();
    dom.mutation();
    dom.frame();
    expect(dom.frames.size).toBe(0);
    expect(dom.scrollIntoView).not.toHaveBeenCalled();
    cleanup();
  },
);
