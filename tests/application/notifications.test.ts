import { beforeEach, expect, it, vi } from "vitest";
import {
  GetLatestNotificationTitle,
  GetMyNotifications,
  GetMyPulse,
  ReadAllMyNotifications,
  ReadMyNotification,
} from "@/application/notifications/use-cases";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { anna, marina, timur } from "../fakes/identity";
import { FakeNotificationsRepository } from "../fakes/notifications";

const id = "00000000-0000-7000-8000-000000000014";
const foreignId = "00000000-0000-7000-8000-000000000015";
let repository: FakeNotificationsRepository;
const clock = new FakeClock("2026-11-04T12:00:00.000Z");
beforeEach(() => {
  repository = new FakeNotificationsRepository();
  repository.items.push(
    ...[anna, timur].map((actor, index) => ({
      id: index ? foreignId : id,
      userId: actor.userId,
      kind: "change" as const,
      priority: "high" as const,
      title: index ? "Другое уведомление" : "Пара перенесена",
      body: "Откройте расписание.",
      link: "/schedule",
      createdAt: "2026-11-04T09:00:00.000Z",
      readAt: null,
    })),
  );
});

it("свои данные, сериализуемый DTO, пустой пульс; чужого заголовка нет", async () => {
  const feed = await new GetMyNotifications(repository).execute(anna);
  expect(feed.high.map((item) => item.id)).toEqual([id]);
  expect(JSON.parse(JSON.stringify(feed))).toEqual(feed);
  expect(await new GetMyPulse(repository).execute(anna)).toEqual({
    unread: 1,
    latestAt: "2026-11-04T09:00:00.000Z",
  });
  expect(
    await new GetLatestNotificationTitle(repository).execute(timur, {
      latestAt: "2026-11-04T09:00:00.000Z",
    }),
  ).toEqual({ latestTitle: "Другое уведомление" });
  repository.items.length = 0;
  expect(await new GetMyPulse(repository).execute(anna)).toEqual({
    unread: 0,
    latestAt: null,
  });
});

it("прочтение идемпотентно, уменьшает счётчик и меняет пульс, массовое не трогает чужие", async () => {
  const read = new ReadMyNotification(repository, clock);
  expect(await read.execute(anna, { id, open: true })).toEqual({
    link: "/schedule",
  });
  expect(await new GetMyPulse(repository).execute(anna)).toEqual({
    unread: 0,
    latestAt: clock.now().toISOString(),
  });
  expect(
    await new GetLatestNotificationTitle(repository).execute(anna, {
      latestAt: clock.now().toISOString(),
    }),
  ).toEqual({ latestTitle: null });
  await read.execute(anna, { id });
  await new ReadAllMyNotifications(repository, clock).execute(anna);
  expect(repository.items[1]?.readAt).toBeNull();
});

it("IDOR в обоих направлениях: чужой и отсутствующий id одинаково 404, данные не изменились", async () => {
  const read = new ReadMyNotification(repository, clock);
  const before = structuredClone(repository.items);
  for (const [actor, target] of [
    [anna, foreignId],
    [timur, id],
    [anna, "00000000-0000-7000-8000-000000000099"],
  ] as const) {
    await expect(read.execute(actor, { id: target })).rejects.toEqual(
      new NotFoundError(),
    );
  }
  expect(repository.items).toEqual(before);
});

it.each(["//evil.example", "https://evil.example", "/\\evil.example"])(
  "внешняя ссылка %s не показывается и не исполняется",
  async (link) => {
    const item = repository.items[0];
    if (!item) throw new Error("Нет тестового уведомления.");
    item.link = link;
    expect(
      (await new GetMyNotifications(repository).execute(anna)).high[0]?.link,
    ).toBeNull();
    await expect(
      new ReadMyNotification(repository, clock).execute(anna, {
        id,
        open: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(item.readAt).toBeNull();
    await new ReadMyNotification(repository, clock).execute(anna, { id });
    expect(item.readAt).not.toBeNull();
  },
);

it("сотруднику запрещены все сценарии до обращения к хранилищу", async () => {
  const list = vi.spyOn(repository, "listForUser");
  for (const query of [
    new GetMyNotifications(repository),
    new GetMyPulse(repository),
    new ReadAllMyNotifications(repository, clock),
  ]) {
    await expect(query.execute(marina)).rejects.toBeInstanceOf(ForbiddenError);
  }
  await expect(
    new ReadMyNotification(repository, clock).execute(marina, { id }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    new GetLatestNotificationTitle(repository).execute(marina, {}),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(list).not.toHaveBeenCalled();
});

it("идентификатор владельца и лишние поля из клиента отклоняются", async () => {
  await expect(
    new ReadMyNotification(repository, clock).execute(anna, {
      id,
      userId: timur.userId,
    }),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    new ReadMyNotification(repository, clock).execute(anna, { id: "bad" }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(repository.items.every((item) => !item.readAt)).toBe(true);
});

it("объявления: профиль выбирается по actor.studentId, аудитория all/факультет/курс/группа, без влияния на счётчик", async () => {
  if (anna.kind !== "student" || timur.kind !== "student")
    throw new Error("Нужен студент.");
  repository.profiles.set(anna.studentId, {
    userId: anna.userId,
    faculty: "fmo",
    course: "2",
    group: "fmo-2",
  });
  repository.profiles.set(timur.studentId, {
    userId: timur.userId,
    faculty: "imp",
    course: "1",
    group: "imp-1",
  });
  for (const [audience, ref] of [
    ["all", null],
    ["faculty", "fmo"],
    ["course", "2"],
    ["group", "fmo-2"],
    ["faculty", "imp"],
    ["course", "1"],
    ["group", "imp-1"],
  ] as const) {
    repository.announcements.push({
      id: `${audience}:${ref}`,
      audience,
      ref,
      title: "Объявление",
      body: "Вымышленный текст",
      publishedAt: clock.now().toISOString(),
    });
  }
  const list = vi.spyOn(repository, "listAnnouncementsForStudent");
  const annaFeed = await new GetMyNotifications(repository).execute(anna);
  expect(list).toHaveBeenCalledWith(anna.studentId, anna.userId);
  expect(annaFeed.announcements.map((item) => item.id)).toEqual([
    "all:null",
    "faculty:fmo",
    "course:2",
    "group:fmo-2",
  ]);
  const timurFeed = await new GetMyNotifications(repository).execute(timur);
  expect(timurFeed.announcements.map((item) => item.id)).toEqual([
    "all:null",
    "faculty:imp",
    "course:1",
    "group:imp-1",
  ]);
  expect((await new GetMyPulse(repository).execute(anna)).unread).toBe(1);
});
