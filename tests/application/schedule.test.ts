import { beforeEach, describe, expect, it } from "vitest";
import {
  GetCalendar,
  RenewCalendarToken,
} from "@/application/schedule/calendar";
import { GetToday, GetWeek } from "@/application/schedule/get-schedule";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import {
  anna,
  change,
  FakeCalendarTokenStore,
  FakeCalendarTokens,
  FakeScheduleRepository,
  scheduleData,
  staff,
  timur,
} from "../fakes/schedule";

let repository: FakeScheduleRepository;
let clock: FakeClock;
beforeEach(() => {
  repository = new FakeScheduleRepository();
  clock = new FakeClock("2026-11-02T09:59:30.000Z");
});

describe("чтение расписания", () => {
  it("берёт группу из профиля Actor, возвращает неделю и данные для главного экрана", async () => {
    const week = await new GetWeek(repository, clock).execute(anna, {
      week: "2026-W45",
    });
    expect(week).toMatchObject({
      group: "МО-ДЕМО-2",
      previousWeek: "2026-W44",
      nextWeek: "2026-W46",
    });
    expect(week.days).toHaveLength(7);
    expect(week.days[0]?.lessons).toHaveLength(2);
    const today = await new GetToday(repository, clock).execute(anna);
    expect(today).toMatchObject({
      next: { course: "История международных отношений" },
      minutesUntilNext: 1,
    });
    expect(today.changes).toHaveLength(1);
    clock.advance(30_000);
    expect(await new GetToday(repository, clock).execute(anna)).toMatchObject({
      current: { status: "moved-to" },
    });
    const other = await new GetWeek(repository, clock).execute(timur);
    expect(other.group).toBe("ИМП-ДЕМО-1");
    expect(JSON.stringify(other)).not.toContain(
      "История международных отношений",
    );
    expect(JSON.stringify(week)).not.toContain("Основы маркетинга");
  });

  it("пустой день подсказывает ближайший учебный день; перенос с сегодняшнего дня остаётся в changes", async () => {
    clock.set("2026-11-01T12:00:00Z");
    expect(await new GetToday(repository, clock).execute(anna)).toMatchObject({
      lessons: [],
      nextStudyDate: "2026-11-02",
    });
    repository.records.set(
      "anna",
      scheduleData({ changes: [change({ newDate: "2026-11-03" })] }),
    );
    clock.set("2026-11-02T12:00:00Z");
    const result = await new GetToday(repository, clock).execute(anna);
    expect(result.changes).toMatchObject([{ status: "moved-from" }]);
    expect(result.nextStudyDate).toBe("2026-11-03");
    repository.records.set("anna", scheduleData({ slots: [] }));
    expect(await new GetToday(repository, clock).execute(anna)).toMatchObject({
      next: null,
      nextStudyDate: null,
    });
  });

  it("находит учебный день после нескольких недель отмен", async () => {
    clock.set("2026-11-01T12:00:00Z");
    repository.records.set(
      "anna",
      scheduleData({
        changes: ["2026-11-02", "2026-11-09", "2026-11-16"].map((date) =>
          change({ id: date, date, kind: "cancelled", newDate: null }),
        ),
      }),
    );
    expect(await new GetToday(repository, clock).execute(anna)).toMatchObject({
      nextStudyDate: "2026-11-23",
    });
  });

  it.each([
    { week: "2025-W53" },
    { week: "2026-W00" },
    { week: ["2026-W45", "2026-W46"] },
    { week: "<script>" },
    { view: "other" },
  ])("валидирует query %j", async (input) => {
    await expect(
      new GetWeek(repository, clock).execute(anna, input),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([
    { studentId: "timur" },
    { groupId: "imp" },
    { userId: "timur-user" },
    { token: "foreign" },
  ])("отклоняет попытку выбрать владельца %j одинаковым 404", async (input) => {
    await expect(
      new GetWeek(repository, clock).execute(anna, input),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      new GetToday(repository, clock).execute(anna, input),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("проверяет роль внутри обоих use cases и скрывает отсутствующий профиль", async () => {
    for (const useCase of [
      new GetWeek(repository, clock),
      new GetToday(repository, clock),
    ]) {
      await expect(useCase.execute(staff)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      repository.records.delete("anna");
      await expect(useCase.execute(anna)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

describe("подписка ICS", () => {
  it("выдаёт токен, хранит только хэш, отзывает старый, не меняет токен другого студента", async () => {
    const store = new FakeCalendarTokenStore();
    const tokens = new FakeCalendarTokens();
    const renew = new RenewCalendarToken(
      store,
      tokens,
      new SequentialIdGenerator(),
      repository,
    );
    const get = new GetCalendar(store, tokens, repository, clock);
    const first = await renew.execute(anna);
    const foreign = await renew.execute(timur);
    const token = first.path.split("/").at(-1);
    const foreignToken = foreign.path.split("/").at(-1);
    expect([...store.records.values()]).not.toContain(token);
    expect(await get.execute(token)).toContain("BEGIN:VCALENDAR");
    expect(await get.execute(token, anna)).toContain(
      "История международных отношений",
    );
    await expect(get.execute(foreignToken, anna)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(get.execute(token, timur)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(get.execute(token, staff)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (const input of [
      { token: foreignToken },
      { studentId: "timur" },
      { groupId: "imp" },
    ])
      await expect(renew.execute(anna, input)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    expect(await get.execute(foreignToken, timur)).toContain(
      "Основы маркетинга",
    );
    const second = await renew.execute(anna);
    expect(first.path === second.path).toBe(false);
    await expect(get.execute(token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(get.execute("a".repeat(43))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(get.execute("invalid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(renew.execute(staff)).rejects.toBeInstanceOf(ForbiddenError);
    repository.records.delete("anna");
    await expect(renew.execute(anna)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("выгружает текущую и три следующие недели, исключает старое время переноса, UID стабилен", async () => {
    const store = new FakeCalendarTokenStore();
    const tokens = new FakeCalendarTokens();
    const path = (
      await new RenewCalendarToken(
        store,
        tokens,
        new SequentialIdGenerator(),
        repository,
      ).execute(anna)
    ).path;
    const get = new GetCalendar(store, tokens, repository, clock);
    const content = await get.execute(path.split("/").at(-1));
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(content).toContain("DTSTART:20261102T100000Z");
    expect(content).not.toContain("DTSTART:20261102T060000Z");
    expect(content).toContain("DTSTART:20261123T060000Z");
    expect(content).not.toContain("DTSTART:20261130");
    clock.advance(60_000);
    expect((await get.execute(path.split("/").at(-1))) === content).toBe(true);
  });
});
