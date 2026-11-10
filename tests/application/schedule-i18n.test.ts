import { expect, it } from "vitest";
import {
  GetCalendar,
  RenewCalendarToken,
} from "@/application/schedule/calendar";
import { GetToday, GetWeek } from "@/application/schedule/get-schedule";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import {
  anna,
  change,
  FakeCalendarTokenStore,
  FakeCalendarTokens,
  FakeScheduleRepository,
  scheduleData,
} from "../fakes/schedule";

it.each(["moved", "room", "cancelled", "replaced"] as const)(
  "DTO расписания: %s — закрытые коды, ISO UTC и неизменённые данные",
  async (kind) => {
    const repository = new FakeScheduleRepository();
    repository.records.set(
      "anna",
      scheduleData({ changes: [change({ kind })] }),
    );
    const clock = new FakeClock("2026-11-02T05:00:00Z");
    const week = await new GetWeek(repository, clock).execute(anna);
    const today = await new GetToday(repository, clock).execute(anna);
    for (const lesson of [
      ...week.days.flatMap((day) => day.lessons),
      ...today.lessons,
    ]) {
      expect(["lecture", "seminar", "exam"]).toContain(lesson.kind);
      expect(["scheduled", "moved-from", "moved-to", "cancelled"]).toContain(
        lesson.status,
      );
      expect(lesson.startsAt).toMatch(/Z$/);
      expect(lesson.endsAt).toMatch(/Z$/);
      expect(lesson.course).toBe("История международных отношений");
      expect(lesson.teacher).toBe("Светлана Рощина");
      for (const item of lesson.changes) {
        expect(item.kind).toBe(kind);
        expect(item.reason).toBe("Учебная встреча перенесена.");
        expect(Object.keys(item).sort()).toEqual([
          "after",
          "before",
          "id",
          "kind",
          "reason",
        ]);
      }
      expect(Object.hasOwn(lesson, "title")).toBe(false);
      expect(Object.hasOwn(lesson, "description")).toBe(false);
    }
  },
);

it("ICS сохраняет русские подписи, названия и данные расписания", async () => {
  const repository = new FakeScheduleRepository();
  const clock = new FakeClock("2026-11-02T05:00:00Z");
  const store = new FakeCalendarTokenStore();
  const tokens = new FakeCalendarTokens();
  const { path } = await new RenewCalendarToken(
    store,
    tokens,
    new SequentialIdGenerator(),
    repository,
  ).execute(anna);
  const calendar = await new GetCalendar(
    store,
    tokens,
    repository,
    clock,
  ).execute(path.split("/").at(-1));
  expect(calendar).toContain("SUMMARY:История международных отношений");
  expect(calendar).toContain("Светлана Рощина");
  expect(calendar.replaceAll("\r\n ", "")).toContain(
    "Учебная встреча перенесена.",
  );
  expect(calendar).not.toContain("Rescheduled");
});
