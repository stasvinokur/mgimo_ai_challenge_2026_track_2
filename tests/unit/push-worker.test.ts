import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUSH_GENERIC_BODY,
  PUSH_REQUEST_BODY,
  PUSH_TEST_BODY,
} from "@/domain/notifications/push-policy";

vi.mock("serwist", () => ({
  Serwist: class {
    addEventListeners() {}
  },
}));

const origin = "https://pulse.example";
type Listener = (event: unknown) => void;
let listeners: Map<string, Listener>;
let display: ReturnType<typeof vi.fn>;
let windows: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;
let warning: ReturnType<typeof vi.spyOn>;
let storage: { open: ReturnType<typeof vi.fn>; keys: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.resetModules();
  listeners = new Map();
  display = vi.fn().mockResolvedValue(undefined);
  windows = vi.fn().mockResolvedValue([]);
  open = vi.fn().mockResolvedValue(null);
  warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  storage = { open: vi.fn(), keys: vi.fn() };
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("self", {
    location: { origin },
    registration: { showNotification: display },
    clients: { matchAll: windows, openWindow: open },
    __SW_MANIFEST: [],
    __PULSE_BUILD_ID: "push-build",
    setTimeout,
    clearTimeout,
    addEventListener(name: string, listener: Listener) {
      listeners.set(name, listener);
    },
  });
  await import("@/ui/shell/pwa-worker");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function dispatch(name: string, fields: Record<string, unknown>) {
  const waiting: Promise<unknown>[] = [];
  const listener = listeners.get(name);
  expect(listener).toBeTypeOf("function");
  listener?.({
    ...fields,
    waitUntil(promise: Promise<unknown>) {
      waiting.push(promise);
    },
  });
  expect(waiting).toHaveLength(1);
  await Promise.all(waiting);
  expect(storage.open).not.toHaveBeenCalled();
  expect(storage.keys).not.toHaveBeenCalled();
}

function notification(link: unknown) {
  return { data: { link }, close: vi.fn() };
}

function client(url: string) {
  const result = {
    url,
    focus: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
  };
  result.navigate.mockResolvedValue(result);
  return result;
}

describe("обработчики Web Push в настоящем service worker", () => {
  it.each([PUSH_REQUEST_BODY, PUSH_TEST_BODY, PUSH_GENERIC_BODY])(
    "показывает фиксированный текст %s и внутреннюю ссылку без кэширования",
    async (body) => {
      await dispatch("push", {
        data: {
          json: () => ({
            title: "Вымышленное ФИО, 98 баллов",
            body,
            link: "/requests/123?tab=events#status",
            personal: "Лишние данные",
          }),
        },
      });
      expect(display).toHaveBeenCalledExactlyOnceWith("Пульс", {
        body,
        icon: "/icons/icon-192.png",
        data: { link: "/requests/123?tab=events#status" },
      });
      expect(warning).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    1,
    "Лишние данные",
    { title: "Вымышленное ФИО", body: "Оценка: 98", link: "https://evil.test" },
  ])("заменяет недоверенные поля безопасным уведомлением: %j", async (data) => {
    await dispatch("push", { data: { json: () => data } });
    expect(display).toHaveBeenCalledExactlyOnceWith("Пульс", {
      body: PUSH_GENERIC_BODY,
      icon: "/icons/icon-192.png",
      data: { link: "/notifications" },
    });
  });

  it("пустой и повреждённый payload всё равно показывают безопасный текст", async () => {
    await dispatch("push", { data: null });
    await dispatch("push", {
      data: {
        json() {
          throw new Error("Секретные данные");
        },
      },
    });
    expect(display).toHaveBeenCalledTimes(2);
    expect(
      display.mock.calls.every(
        ([, options]) => options.body === PUSH_GENERIC_BODY,
      ),
    ).toBe(true);
    expect(warning).toHaveBeenCalledExactlyOnceWith("PUSH_PAYLOAD_INVALID");
  });

  it("клик фокусирует вкладку с точным URL без навигации", async () => {
    const unrelated = client(`${origin}/schedule`);
    const current = client(`${origin}/notifications`);
    windows.mockResolvedValue([unrelated, current]);
    const item = notification("/notifications");
    await dispatch("notificationclick", { notification: item });
    expect(item.close).toHaveBeenCalledOnce();
    expect(windows).toHaveBeenCalledExactlyOnceWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(current.focus).toHaveBeenCalledOnce();
    expect(current.navigate).not.toHaveBeenCalled();
    expect(unrelated.focus).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("клик открывает внутреннюю ссылку в существующей вкладке и фокусирует её", async () => {
    const foreign = client("https://evil.test/today");
    const current = client(`${origin}/today`);
    windows.mockResolvedValue([foreign, current]);
    await dispatch("notificationclick", {
      notification: notification("/requests/123"),
    });
    expect(current.navigate).toHaveBeenCalledExactlyOnceWith(
      `${origin}/requests/123`,
    );
    expect(current.focus).toHaveBeenCalledOnce();
    expect(foreign.navigate).not.toHaveBeenCalled();
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("без своей вкладки открывает новое окно с внутренней ссылкой", async () => {
    windows.mockResolvedValue([client("https://evil.test")]);
    await dispatch("notificationclick", {
      notification: notification("/notifications"),
    });
    expect(open).toHaveBeenCalledExactlyOnceWith(`${origin}/notifications`);
  });

  it("если navigate не вернул вкладку, открывает новое окно", async () => {
    const current = client(`${origin}/today`);
    current.navigate.mockResolvedValue(null);
    windows.mockResolvedValue([current]);
    await dispatch("notificationclick", {
      notification: notification("/notifications"),
    });
    expect(current.focus).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledExactlyOnceWith(`${origin}/notifications`);
  });

  it("если navigate неконтролируемой вкладки отклонён, открывает новое окно", async () => {
    const current = client(`${origin}/today`);
    current.navigate.mockRejectedValue(new Error("Секретные данные вкладки"));
    windows.mockResolvedValue([current]);
    await dispatch("notificationclick", {
      notification: notification("/notifications"),
    });
    expect(current.focus).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledExactlyOnceWith(`${origin}/notifications`);
    expect(warning).toHaveBeenCalledExactlyOnceWith("PUSH_NAVIGATE_FAILED");
  });

  it.each([
    "https://evil.test/requests/123",
    "//evil.test",
    "/\\evil.test",
    "/%2f%2fevil.test",
    "/%5cevil.test",
    "/\nevil.test",
    "/%0aevil.test",
    "javascript:alert(1)",
    " /notifications",
    null,
    {},
  ])("клик не открывает недоверенную ссылку %j", async (link) => {
    const item = notification(link);
    await dispatch("notificationclick", { notification: item });
    expect(item.close).toHaveBeenCalledOnce();
    expect(windows).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("сбои показа и клика журналируются фиксированными кодами", async () => {
    display.mockRejectedValue(new Error("Секретный payload"));
    await dispatch("push", { data: null });
    windows.mockRejectedValue(new Error("Секретная ссылка"));
    await dispatch("notificationclick", {
      notification: notification("/notifications"),
    });
    expect(warning.mock.calls).toEqual([
      ["PUSH_DISPLAY_FAILED"],
      ["PUSH_OPEN_FAILED"],
    ]);
  });
});
