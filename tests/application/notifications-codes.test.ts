import { expect, it } from "vitest";
import { ReadMyNotification } from "@/application/notifications/use-cases";
import { ValidationError } from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { anna } from "../fakes/identity";
import { FakeNotificationsRepository } from "../fakes/notifications";

it("ошибки данных и недоступной ссылки возвращают закрытые коды без русских фраз", async () => {
  const repository = new FakeNotificationsRepository();
  const id = "00000000-0000-7000-8000-000000000014";
  repository.items.push({
    id,
    userId: anna.userId,
    kind: "news",
    priority: "normal",
    title: "Вымышленное уведомление",
    body: "Текст из БД",
    link: "https://invalid.example",
    readAt: null,
    createdAt: "2026-11-04T09:00:00Z",
  });
  const read = new ReadMyNotification(
    repository,
    new FakeClock("2026-11-04T12:00:00Z"),
  );
  for (const [input, fields] of [
    [{ id, userId: "client-owner" }, { notification: ["notificationInvalid"] }],
    [{ id, open: true }, { link: ["notificationLinkUnavailable"] }],
  ] as const) {
    try {
      await read.execute(anna, input);
      expect.fail("Ожидалась ошибка валидации");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toEqual(fields);
    }
  }
  expect(repository.items[0]?.readAt).toBeNull();
});
