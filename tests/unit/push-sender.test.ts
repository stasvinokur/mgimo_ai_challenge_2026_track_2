import { afterEach, expect, it, vi } from "vitest";
import webPush from "web-push";
import { WebPushSender } from "@/infrastructure/push/sender";

const payload = {
  title: "Пульс",
  body: "Новое уведомление.",
  link: "/notifications",
};
const keys = { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) };
function sender() {
  return new WebPushSender({
    ...webPush.generateVAPIDKeys(),
    subject: "mailto:push@example.invalid",
  });
}
afterEach(() => vi.restoreAllMocks());

it.each([
  "https:fcm.googleapis.com/fcm/send/test",
  "https:/fcm.googleapis.com/fcm/send/test",
  "https://fcm.googleapis.com:443/fcm/send/test",
  "https://FCM.googleapis.com/fcm/send/test",
  "HTTPS://fcm.googleapis.com/fcm/send/test",
])(
  "не передаёт неканонический endpoint в устаревший URL-парсер: %s",
  async (endpoint) => {
    const send = vi.spyOn(webPush, "sendNotification");
    expect(await sender().send({ endpoint, keys }, payload)).toEqual({
      status: "failed",
    });
    expect(send).not.toHaveBeenCalled();
  },
);

it("ограничивает ожидание push-службы двумя секундами", async () => {
  const send = vi
    .spyOn(webPush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys,
  };
  expect(await sender().send(subscription, payload)).toEqual({
    status: "sent",
  });
  expect(send).toHaveBeenCalledWith(
    subscription,
    JSON.stringify(payload),
    expect.objectContaining({ timeout: 2000 }),
  );
});
