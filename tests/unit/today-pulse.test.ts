import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Layout from "@/app/(student)/layout";
import type { PulseDto } from "@/application/notifications/ports";
import { startPulsePolling } from "@/ui/notifications/pulse-poller";
import { anna } from "../fakes/identity";

const mocks = vi.hoisted(() => ({
  requireStudent: vi.fn(),
  getPulse: vi.fn(),
  logError: vi.fn(),
  latestTitle: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/composition/container", () => ({
  notifications: { getMyPulse: { execute: mocks.getPulse } },
  system: { logger: { error: mocks.logError } },
}));
vi.mock("@/app/(student)/notifications/actions", () => ({
  latestNotificationTitleAction: mocks.latestTitle,
}));
vi.mock("@/app/(student)/requests/actions", () => ({
  getRequestProfileAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: mocks.refresh }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStudent.mockResolvedValue(anna);
  mocks.getPulse.mockReset();
});
afterEach(() => vi.useRealTimers());

it("сбой счётчика сохраняет кабинет, скрывает число, запускает LivePulse без снимка и логирует только код", async () => {
  mocks.getPulse.mockRejectedValue(
    new Error("Внутренние подробности ошибки источника"),
  );
  const element = await Layout({ children: "Содержимое кабинета" });
  expect(mocks.getPulse).toHaveBeenCalledExactlyOnceWith(anna);
  expect(mocks.logError).toHaveBeenCalledExactlyOnceWith(
    "student_pulse_unavailable",
    { code: "PULSE_UNAVAILABLE" },
  );
  expect(element.props.unreadNotifications).toBeNull();
  expect(element.props.children[0].props.initial).toBeNull();
  const html = renderToStaticMarkup(element);
  expect(html).toContain("Содержимое кабинета");
  expect(html).toContain('aria-label="Уведомления"');
  expect(html).not.toContain("data-unread-count");
  expect(html).not.toContain("непрочитанных");
  expect(html).not.toContain("Внутренние подробности");
});

it.each([0, 3])(
  "успешный снимок с unread=%s остаётся в шапке и передаётся поллеру",
  async (unread) => {
    const pulse = { unread, latestAt: null };
    mocks.getPulse.mockResolvedValue(pulse);
    const element = await Layout({ children: "Содержимое кабинета" });
    expect(element.props.children[0].props.initial).toEqual(pulse);
    const html = renderToStaticMarkup(element);
    expect(html).toContain(`aria-label="Уведомления: ${unread} непрочитанных"`);
    expect(html).toContain(`data-unread-count="${unread}"`);
    expect(mocks.logError).not.toHaveBeenCalled();
  },
);

it("layout дожидается requireStudent до счётчика, отказ доступа не перехватывается", async () => {
  let rejectGuard: (error: Error) => void = () => {};
  mocks.requireStudent.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectGuard = reject;
    }),
  );
  const result = Layout({ children: "Содержимое кабинета" });
  expect(mocks.requireStudent).toHaveBeenCalledOnce();
  expect(mocks.getPulse).not.toHaveBeenCalled();
  const denied = new Error("Доступ закрыт");
  const rejection = expect(result).rejects.toBe(denied);
  rejectGuard(denied);
  await rejection;
  expect(mocks.getPulse).not.toHaveBeenCalled();
  expect(mocks.logError).not.toHaveBeenCalled();
});

it.each([
  { unread: 0, latestAt: null },
  { unread: 2, latestAt: "2026-11-04T09:00:00.000Z" },
])(
  "без снимка первый успешный опрос восстанавливает данные $unread/$latestAt",
  async (pulse: PulseDto) => {
    vi.useFakeTimers();
    const changed = vi.fn().mockResolvedValue(undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValue(pulse);
    const stop = startPulsePolling({
      initial: null,
      visible: () => true,
      subscribe: () => () => {},
      load,
      changed,
      unauthorized: vi.fn(),
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(changed).toHaveBeenCalledExactlyOnceWith(pulse, null);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(load).toHaveBeenCalledTimes(3);
      expect(changed).toHaveBeenCalledOnce();
      const next = { ...pulse, unread: pulse.unread + 1 };
      load.mockResolvedValue(next);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(changed).toHaveBeenLastCalledWith(next, pulse);
    } finally {
      stop();
    }
  },
);
