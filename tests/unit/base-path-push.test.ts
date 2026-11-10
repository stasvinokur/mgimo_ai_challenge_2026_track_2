import { expect, it, vi } from "vitest";
import { WebPushSender } from "@/infrastructure/push/sender";
import { registerPushHandlers } from "@/ui/notifications/push-worker";

vi.mock("web-push", () => ({
  default: { sendNotification: vi.fn().mockResolvedValue({}) },
}));

it.each(["", "/dekanat"])(
  "push: ссылка и иконка в папке, окно соседнего решения не используется %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", base);
    const webPush = (await import("web-push")).default;
    const sender = new WebPushSender(
      {
        publicKey: "public",
        privateKey: "private",
        subject: "mailto:demo@example.com",
      },
      base,
    );
    await sender.send(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/demo",
        keys: { p256dh: "public", auth: "auth" },
      },
      {
        title: "Пульс",
        body: "Есть новое уведомление в кабинете.",
        link: "/notifications",
      },
    );
    const payload = JSON.parse(
      vi.mocked(webPush.sendNotification).mock.calls.at(-1)?.[1] as string,
    );
    expect(payload.link).toBe(`${base}/notifications`);
    const origin = "https://pulse.example";
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    const openWindow = vi.fn().mockResolvedValue(null);
    const worker = {
      location: { origin },
      registration: { showNotification },
      clients: {
        matchAll: async () => [{ url: `${origin}/other/`, navigate }],
        openWindow,
      },
      addEventListener: (name: string, listener: (event: unknown) => void) =>
        listeners.set(name, listener),
    } as unknown as ServiceWorkerGlobalScope;
    registerPushHandlers(worker);
    async function dispatch(name: string, data: object) {
      const waiting: Promise<unknown>[] = [];
      listeners.get(name)?.({
        ...data,
        waitUntil: (p: Promise<unknown>) => waiting.push(p),
      });
      await Promise.all(waiting);
    }
    await dispatch("push", { data: { json: () => payload } });
    expect(showNotification).toHaveBeenCalledWith(
      "Пульс",
      expect.objectContaining({
        icon: `${base}/icons/icon-192.png`,
        data: { link: `${base}/notifications` },
      }),
    );
    await dispatch("notificationclick", {
      notification: { data: { link: payload.link }, close() {} },
    });
    expect(openWindow).toHaveBeenCalledWith(`${origin}${base}/notifications`);
    if (base) expect(navigate).not.toHaveBeenCalled();
    if (base) {
      openWindow.mockClear();
      await dispatch("notificationclick", {
        notification: { data: { link: "/../other/" }, close() {} },
      });
      expect(openWindow).not.toHaveBeenCalled();
    }
  },
);
