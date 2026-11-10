import { describe, expect, it } from "vitest";
import {
  ACTIVITY_GOAL,
  attendanceTotals,
  attendanceWindowOpen,
  CODE_LIFETIME_MS,
  CODE_ROTATION_MS,
  canCloseAttendance,
  codeTiming,
  lessonSourceKey,
  PRESENT_POINTS,
} from "@/domain/attendance/policy";
import { buildSchedule } from "@/domain/schedule/schedule";
import { scheduleData } from "../fakes/schedule";

const lesson = buildSchedule(scheduleData(), "2026-11-02", "2026-11-02")[0];
if (!lesson) throw new Error("Нет занятия для проверки.");
describe("Окно посещаемости", () => {
  it.each([
    [-600001, false],
    [-600000, true],
    [0, true],
    [5399999, true],
    [5400000, false],
  ])("граница %i мс → %s", (delta, expected) => {
    expect(
      attendanceWindowOpen(
        lesson,
        new Date(Date.parse(lesson.startsAt) + delta),
      ),
    ).toBe(expected);
  });
  it("отмена и старый адрес переноса закрыты; новое время определяет окно", () => {
    for (const status of ["cancelled", "moved-from"] as const)
      expect(
        attendanceWindowOpen({ ...lesson, status }, new Date(lesson.startsAt)),
      ).toBe(false);
    const moved = {
      ...lesson,
      status: "moved-to" as const,
      startsAt: "2026-11-03T10:00:00Z",
      endsAt: "2026-11-03T11:30:00Z",
    };
    expect(attendanceWindowOpen(moved, new Date(lesson.startsAt))).toBe(false);
    expect(attendanceWindowOpen(moved, new Date(moved.startsAt))).toBe(true);
  });
  it("код живёт 30 с, смена через 20 с, срок обрезается концом пары", () => {
    expect([CODE_ROTATION_MS, CODE_LIFETIME_MS]).toEqual([20000, 30000]);
    const now = new Date(lesson.startsAt);
    const timing = codeTiming(now, lesson);
    expect(Date.parse(timing.rotateAt) - now.getTime()).toBe(20000);
    expect(Date.parse(timing.expiresAt) - now.getTime()).toBe(30000);
    const end = new Date(Date.parse(lesson.endsAt) - 1);
    expect(codeTiming(end, lesson)).toEqual({
      rotateAt: lesson.endsAt,
      expiresAt: lesson.endsAt,
    });
  });
});
it("процент считает только проведённую отметку, уважительные причины отдельно", () => {
  expect(attendanceTotals([])).toEqual({
    present: 0,
    absent: 0,
    excused: 0,
    total: 0,
    percent: null,
  });
  expect(attendanceTotals(["excused"])).toMatchObject({
    total: 0,
    percent: null,
    excused: 1,
  });
  expect(
    attendanceTotals(["present", "present", "absent", "excused"]),
  ).toMatchObject({ present: 2, total: 3, excused: 1, percent: 67 });
});
it("целый процент соответствует рациональному округлению для всех небольших составов", () => {
  for (let total = 1; total <= 100; total++)
    for (let present = 0; present <= total; present++) {
      const statuses = [
        ...Array<"present">(present).fill("present"),
        ...Array<"absent">(total - present).fill("absent"),
        "excused" as const,
      ];
      const percent = attendanceTotals(statuses).percent;
      expect(percent).not.toBeNull();
      expect(
        Math.abs((percent ?? 0) * total - present * 100),
      ).toBeLessThanOrEqual(total / 2);
    }
});
it("личная цель 20 баллов и +1 за занятие; источник не зависит от ротируемого кода", () => {
  expect(ACTIVITY_GOAL).toBe(20);
  expect(PRESENT_POINTS).toBe(1);
  expect(
    lessonSourceKey({ slotId: "slot", occurrenceDate: "2026-11-02" }),
  ).toBe("qr:slot:2026-11-02");
});

describe("Окно закрытия отметки", () => {
  it.each([
    [-600001, false],
    [-600000, true],
    [0, true],
    [12599999, true],
    [12600000, false],
  ])("граница относительно начала %i мс → %s", (delta, expected) => {
    expect(
      canCloseAttendance(lesson, new Date(Date.parse(lesson.startsAt) + delta)),
    ).toBe(expected);
  });
  it("прошедшая дата, будущая дата, отмена и исходный перенос закрыты", () => {
    expect(canCloseAttendance(lesson, new Date("2026-11-03T06:00:00Z"))).toBe(
      false,
    );
    expect(canCloseAttendance(lesson, new Date("2026-11-01T06:00:00Z"))).toBe(
      false,
    );
    for (const status of ["cancelled", "moved-from"] as const)
      expect(
        canCloseAttendance({ ...lesson, status }, new Date(lesson.endsAt)),
      ).toBe(false);
  });
  it("полночь по Москве обрезает два часа после поздней пары", () => {
    const late = {
      ...lesson,
      startsAt: "2026-11-02T19:00:00.000Z",
      endsAt: "2026-11-02T20:30:00.000Z",
    };
    expect(canCloseAttendance(late, new Date("2026-11-02T20:59:59.999Z"))).toBe(
      true,
    );
    expect(canCloseAttendance(late, new Date("2026-11-02T21:00:00.000Z"))).toBe(
      false,
    );
  });
  it("при переносе действует фактический день, исходный occurrenceDate сохраняется в ключе", () => {
    const moved = {
      ...lesson,
      date: "2026-11-03",
      status: "moved-to" as const,
      startsAt: "2026-11-03T06:00:00.000Z",
      endsAt: "2026-11-03T07:30:00.000Z",
    };
    expect(
      canCloseAttendance(moved, new Date("2026-11-02T07:30:00.000Z")),
    ).toBe(false);
    expect(
      canCloseAttendance(moved, new Date("2026-11-03T09:29:59.999Z")),
    ).toBe(true);
    expect(
      canCloseAttendance(moved, new Date("2026-11-03T09:30:00.000Z")),
    ).toBe(false);
  });
});
