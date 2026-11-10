import { moscowDate } from "../schedule/dates";
import type { Lesson } from "../schedule/schedule";
import { isActive } from "../schedule/schedule";
import type { AttendanceStatus, LessonKey } from "./attendance";

export const CODE_ROTATION_MS = 20_000;
export const CODE_LIFETIME_MS = 30_000;
export const ACTIVITY_GOAL = 20;
export const PRESENT_POINTS = 1;

export function attendanceWindowOpen(lesson: Lesson, now: Date): boolean {
  const at = now.getTime();
  return (
    isActive(lesson) &&
    at >= Date.parse(lesson.startsAt) - 600_000 &&
    at < Date.parse(lesson.endsAt)
  );
}

export function canCloseAttendance(lesson: Lesson, now: Date): boolean {
  return (
    isActive(lesson) &&
    moscowDate(now) === lesson.date &&
    now.getTime() >= Date.parse(lesson.startsAt) - 600_000 &&
    now.getTime() < Date.parse(lesson.endsAt) + 2 * 3_600_000
  );
}

export function codeTiming(now: Date, lesson: Lesson) {
  const end = Date.parse(lesson.endsAt);
  return {
    expiresAt: new Date(
      Math.min(now.getTime() + CODE_LIFETIME_MS, end),
    ).toISOString(),
    rotateAt: new Date(
      Math.min(now.getTime() + CODE_ROTATION_MS, end),
    ).toISOString(),
  };
}

export const lessonSourceKey = (key: LessonKey) =>
  `qr:${key.slotId}:${key.occurrenceDate}`;

export function attendanceTotals(statuses: readonly AttendanceStatus[]) {
  const present = statuses.filter((status) => status === "present").length;
  const absent = statuses.filter((status) => status === "absent").length;
  const excused = statuses.filter((status) => status === "excused").length;
  const total = present + absent;
  // Round half up using integer arithmetic; excused never enters the denominator.
  const percent = total
    ? Number(
        (BigInt(present) * BigInt(200) + BigInt(total)) /
          (BigInt(2) * BigInt(total)),
      )
    : null;
  return { present, absent, excused, total, percent };
}
