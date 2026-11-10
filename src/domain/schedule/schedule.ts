import { addDays, atMoscow, isoWeek, weekday } from "./dates";

export interface ScheduleSlot {
  id: string;
  course: string;
  teacher: string;
  room: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  kind: "lecture" | "seminar" | "exam";
  weekParity: "any" | "odd" | "even";
}

export interface ScheduleChange {
  id: string;
  slotId: string;
  date: string;
  kind: "moved" | "room" | "cancelled" | "replaced";
  oldStartsAt: string | null;
  oldEndsAt: string | null;
  oldRoom: string | null;
  oldTeacher: string | null;
  newDate: string | null;
  newStartsAt: string | null;
  newEndsAt: string | null;
  newRoom: string | null;
  newTeacher: string | null;
  reason: string;
  createdAt: string;
}

export interface ScheduleData {
  group: string;
  slots: ScheduleSlot[];
  changes: ScheduleChange[];
}

export interface LessonTime {
  startsAt: string;
  endsAt: string;
  room: string;
  teacher: string;
}

export interface LessonChange {
  id: string;
  kind: ScheduleChange["kind"];
  reason: string;
  before: LessonTime;
  after: LessonTime;
}

export interface Lesson extends LessonTime {
  id: string;
  uid: string;
  date: string;
  course: string;
  kind: ScheduleSlot["kind"];
  status: "scheduled" | "moved-from" | "moved-to" | "cancelled";
  changes: LessonChange[];
  revision: number;
  updatedAt: string;
}

function occurs(slot: ScheduleSlot, date: string): boolean {
  const parity = Number(isoWeek(date).slice(6)) % 2 ? "odd" : "even";
  return (
    slot.weekday === weekday(date) &&
    (slot.weekParity === "any" || slot.weekParity === parity)
  );
}

export function buildSchedule(
  data: ScheduleData,
  from: string,
  to: string,
): Lesson[] {
  const result: Lesson[] = [];
  for (const slot of data.slots) {
    const dates = new Set<string>();
    for (let date = from; date <= to; date = addDays(date, 1)) dates.add(date);
    for (const change of data.changes) {
      if (
        change.slotId === slot.id &&
        change.newDate &&
        change.newDate >= from &&
        change.newDate <= to
      )
        dates.add(change.date);
    }
    for (const date of dates) {
      if (!occurs(slot, date)) continue;
      const changes = data.changes
        .filter((c) => c.slotId === slot.id && c.date === date)
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      const first = changes[0];
      const initial: LessonTime = {
        startsAt: atMoscow(date, first?.oldStartsAt ?? slot.startsAt),
        endsAt: atMoscow(date, first?.oldEndsAt ?? slot.endsAt),
        room: first?.oldRoom ?? slot.room,
        teacher: first?.oldTeacher ?? slot.teacher,
      };
      let current = { ...initial };
      let targetDate = date;
      let moved = false;
      let cancelled = false;
      const diffs: LessonChange[] = [];
      for (const change of changes) {
        const before = { ...current };
        targetDate = change.newDate ?? targetDate;
        current = {
          startsAt: atMoscow(
            targetDate,
            change.newStartsAt ??
              new Date(Date.parse(current.startsAt) + 3 * 3_600_000)
                .toISOString()
                .slice(11, 19),
          ),
          endsAt: atMoscow(
            targetDate,
            change.newEndsAt ??
              new Date(Date.parse(current.endsAt) + 3 * 3_600_000)
                .toISOString()
                .slice(11, 19),
          ),
          room: change.newRoom ?? current.room,
          teacher: change.newTeacher ?? current.teacher,
        };
        diffs.push({
          id: change.id,
          kind: change.kind,
          reason: change.reason,
          before,
          after: { ...current },
        });
        moved ||= change.kind === "moved";
        cancelled ||= change.kind === "cancelled";
      }
      const base = {
        id: `${slot.id}:${date}`,
        uid: `${slot.id}-${date}@pulse`,
        date,
        course: slot.course,
        kind: slot.kind,
        changes: diffs,
        revision: changes.length,
        updatedAt: changes.at(-1)?.createdAt ?? initial.startsAt,
      };
      if (moved) result.push({ ...base, ...initial, status: "moved-from" });
      result.push({
        ...base,
        ...current,
        date: targetDate,
        status: cancelled ? "cancelled" : moved ? "moved-to" : "scheduled",
      });
    }
  }
  return result
    .filter((lesson) => lesson.date >= from && lesson.date <= to)
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
}

export function isActive(lesson: Lesson): boolean {
  return lesson.status !== "moved-from" && lesson.status !== "cancelled";
}

export function daySummary(lessons: Lesson[], date: string, now: Date) {
  const active = lessons.filter(isActive);
  const current =
    active.find(
      (l) =>
        Date.parse(l.startsAt) <= now.getTime() &&
        Date.parse(l.endsAt) > now.getTime(),
    ) ?? null;
  const next =
    active.find((l) => Date.parse(l.startsAt) > now.getTime()) ?? null;
  return {
    current: current?.date === date ? current : null,
    next,
    minutesUntilNext: next
      ? Math.ceil((Date.parse(next.startsAt) - now.getTime()) / 60_000)
      : null,
    nextStudyDate: active.find((l) => l.date > date)?.date ?? null,
  };
}
