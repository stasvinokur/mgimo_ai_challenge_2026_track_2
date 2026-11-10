import { describe, expect, it } from "vitest";
import { attendanceWindowOpen } from "@/domain/attendance/policy";
import { moscowDate, weekday } from "@/domain/schedule/dates";
import { buildSchedule } from "@/domain/schedule/schedule";
import { scheduleData, slot } from "../fakes/schedule";
import { attendanceLessonTime } from "../integration/attendance-data";

describe("Время временной пары галереи", () => {
  it.each([
    {
      scenario: "днём",
      at: "2026-11-05T09:37:00Z",
      startsAt: "12:15:00",
      endsAt: "13:45:00",
    },
    {
      scenario: "сразу после полуночи",
      at: "2026-11-04T21:01:30Z",
      startsAt: "00:00:00",
      endsAt: "01:30:00",
    },
    {
      scenario: "незадолго до полуночи",
      at: "2026-11-05T20:59:30Z",
      startsAt: "22:29:59",
      endsAt: "23:59:59",
    },
  ])("$scenario: 90 минут и открытая отметка", ({ at, startsAt, endsAt }) => {
    const now = new Date(at);
    const times = attendanceLessonTime(now);
    expect(times).toEqual({ startsAt, endsAt });
    const date = moscowDate(now);
    const lesson = buildSchedule(
      scheduleData({ slots: [{ ...slot, weekday: weekday(date), ...times }] }),
      date,
      date,
    )[0];
    if (!lesson) throw new Error("Нет временной пары для проверки.");
    expect(Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)).toBe(
      90 * 60_000,
    );
    expect(moscowDate(new Date(lesson.startsAt))).toBe(date);
    expect(moscowDate(new Date(lesson.endsAt))).toBe(date);
    expect(attendanceWindowOpen(lesson, now)).toBe(true);
  });
});
