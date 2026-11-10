import { describe, expect, it, vi } from "vitest";
import type { RuntimeInput } from "@/application/assistant/ports";
import type {
  Lesson,
  TodayScheduleDto,
  WeekScheduleDto,
} from "@/application/schedule/get-schedule";
import {
  assistantFixture,
  collect,
  threadId,
  toolRuntime,
} from "../fakes/assistant";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const moscowDateTime = (instant: string) =>
  `${dateTime.format(new Date(instant))} МСК`;
const moscowTime = (instant: string) => time.format(new Date(instant));
const moscowDate = (instant: string) => date.format(new Date(instant));

interface TimedLesson extends Lesson {
  startsAtMoscow: string;
  endsAtMoscow: string;
  relativeTime: string;
}
interface ScheduleContext {
  nowMoscow: string;
  schedule: {
    current: TimedLesson | null;
    next: TimedLesson | null;
    changes: TimedLesson[];
  };
}
interface ScheduleResult {
  nowMoscow: string;
  current: TimedLesson | null;
  next: TimedLesson | null;
  changes: TimedLesson[];
  days: { lessons: TimedLesson[] }[];
}

function lesson(
  startsAt: string,
  endsAt: string,
  overrides: Partial<Lesson> = {},
): Lesson {
  return {
    id: "lesson-1",
    uid: "lesson-1:occurrence",
    date: moscowDate(startsAt),
    course: "Введение в международные отношения",
    teacher: "Вымышленный преподаватель",
    room: "204",
    startsAt,
    endsAt,
    kind: "seminar",
    status: "scheduled",
    changes: [],
    revision: 0,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

async function inspectSchedule(
  now: string,
  current: Lesson | null,
  next: Lesson | null,
  changes: Lesson[] = next ? [next] : current ? [current] : [],
) {
  let context: ScheduleContext | undefined;
  const results = {} as Record<"next" | "changes" | "week", ScheduleResult>;
  const runtime = toolRuntime(async (input: RuntimeInput) => {
    context = JSON.parse(input.context) as ScheduleContext;
    for (const view of ["next", "changes", "week"] as const)
      results[view] = (await input.tools.execute("find_schedule", {
        view,
      })) as ScheduleResult;
  });
  const f = assistantFixture(runtime);
  f.clock.set(now);
  const lessons = [...new Set([current, next, ...changes])].filter(
    (item): item is Lesson => item !== null,
  );
  const today: TodayScheduleDto = {
    group: "ДЕМО-21",
    date: moscowDate(now),
    now: new Date(now).toISOString(),
    lessons,
    changes,
    current,
    next,
    minutesUntilNext: next
      ? Math.ceil((Date.parse(next.startsAt) - Date.parse(now)) / 60_000)
      : null,
    nextStudyDate: next?.date ?? null,
  };
  const week: WeekScheduleDto = {
    group: today.group,
    week: "2026-W45",
    previousWeek: "2026-W44",
    nextWeek: "2026-W46",
    currentWeek: "2026-W45",
    today: today.date,
    now: today.now,
    days: [{ date: today.date, lessons }],
  };
  const originals = structuredClone({ today, week });
  const getToday = vi.fn(async () => today);
  const getWeek = vi.fn(async () => week);
  f.deps.schedule.getToday = { execute: getToday };
  f.deps.schedule.getWeek = { execute: getWeek };
  await collect(
    await f.ask.execute(f.actor, {
      action: "ask",
      threadId,
      question: "Что изменилось в расписании?",
    }),
  );
  if (!context) throw new Error("Контекст не передан рантайму");
  expect(getToday).toHaveBeenCalledExactlyOnceWith(f.actor);
  expect(getWeek).toHaveBeenCalledExactlyOnceWith(f.actor);
  expect({ today, week }).toEqual(originals);
  return { context, results };
}

describe("Ассистент: время расписания вычисляет код", () => {
  it.each([
    [1, "через 1 минуту"],
    [2, "через 2 минуты"],
    [5, "через 5 минут"],
    [21, "через 21 минуту"],
    [61, "через 1 час 1 минуту"],
    [122, "через 2 часа 2 минуты"],
    [185, "через 3 часа 5 минут"],
  ])(
    "через %s минут: раскрывает сокращения для речи — %s",
    async (minutes, expected) => {
      const now = "2026-11-05T12:06:00Z";
      const startsAt = new Date(Date.parse(now) + Number(minutes) * 60_000);
      const next = lesson(
        startsAt.toISOString(),
        new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
      );
      const { context, results } = await inspectSchedule(now, null, next);
      expect(context.schedule.next?.relativeTime).toBe(expected);
      expect(results.next.next?.relativeTime).toBe(expected);
    },
  );

  it("12:06Z → 12:15Z: контекст и все виды тула дают девять минут и явное МСК", async () => {
    const now = "2026-11-05T12:06:00Z";
    const next = lesson("2026-11-05T12:15:00Z", "2026-11-05T13:45:00Z");
    const { context, results } = await inspectSchedule(now, null, next);
    const expected = {
      ...next,
      startsAtMoscow: moscowDateTime(next.startsAt),
      endsAtMoscow: moscowDateTime(next.endsAt),
      relativeTime: "через 9 минут",
    };
    expect(context.nowMoscow).toBe(moscowDateTime(now));
    expect(context.nowMoscow).toContain(moscowTime(now));
    expect(context.schedule).toMatchObject({
      current: null,
      next: expected,
      changes: [expected],
    });
    for (const view of ["next", "changes", "week"] as const)
      expect(results[view].nowMoscow).toBe(moscowDateTime(now));
    expect(results.next).toMatchObject({ current: null, next: expected });
    expect(results.changes).toMatchObject({
      current: null,
      next: expected,
      changes: [expected],
    });
    expect(results.week.days[0]?.lessons).toEqual([expected]);
    expect(next).not.toHaveProperty("relativeTime");
    expect(next).not.toHaveProperty("startsAtMoscow");
  });

  it("текущая пара содержит готовое состояние и московское время окончания", async () => {
    const now = "2026-11-05T12:25:00Z";
    const current = lesson("2026-11-05T12:15:00Z", "2026-11-05T13:45:00Z");
    const next = lesson("2026-11-05T14:00:00Z", "2026-11-05T15:30:00Z", {
      id: "lesson-2",
      uid: "lesson-2:occurrence",
    });
    const { context, results } = await inspectSchedule(now, current, next, [
      current,
    ]);
    const relativeTime = `идёт сейчас, до ${moscowTime(current.endsAt)} МСК`;
    expect(context.schedule.current).toMatchObject({
      relativeTime,
      endsAtMoscow: moscowDateTime(current.endsAt),
    });
    expect(results.next.current?.relativeTime).toBe(relativeTime);
    expect(results.changes.current?.relativeTime).toBe(relativeTime);
    expect(results.changes.changes[0]?.relativeTime).toBe(relativeTime);
    expect(results.week.days[0]?.lessons[0]?.relativeTime).toBe(relativeTime);
  });

  it("ближайшая пара завтра содержит готовое московское время", async () => {
    const now = "2026-11-05T16:25:00Z";
    const next = lesson("2026-11-06T06:00:00Z", "2026-11-06T07:30:00Z");
    const { context, results } = await inspectSchedule(now, null, next);
    const relativeTime = `завтра в ${moscowTime(next.startsAt)}`;
    expect(context.schedule.next?.relativeTime).toBe(relativeTime);
    expect(results.next.next?.relativeTime).toBe(relativeTime);
    expect(results.changes.changes[0]?.relativeTime).toBe(relativeTime);
    expect(results.week.days[0]?.lessons[0]?.relativeTime).toBe(relativeTime);
  });

  it("московская полночь меняет «завтра» на сегодняшний отсчёт до смены даты UTC", async () => {
    const before = "2026-11-05T20:59:00Z";
    const after = "2026-11-05T21:00:00Z";
    const next = lesson("2026-11-06T06:00:00Z", "2026-11-06T07:30:00Z");
    const initial = await inspectSchedule(before, null, next);
    const updated = await inspectSchedule(after, null, next);
    expect(before.slice(0, 10)).toBe(after.slice(0, 10));
    expect(moscowDate(before)).not.toBe(moscowDate(after));
    expect(initial.context.nowMoscow).toBe(moscowDateTime(before));
    expect(updated.context.nowMoscow).toBe(moscowDateTime(after));
    expect(initial.context.schedule.next?.relativeTime).toBe(
      `завтра в ${moscowTime(next.startsAt)}`,
    );
    expect(updated.context.schedule.next?.relativeTime).toBe("через 9 часов");
    expect(initial.results.next.next?.relativeTime).toBe(
      initial.context.schedule.next?.relativeTime,
    );
    expect(updated.results.next.next?.relativeTime).toBe("через 9 часов");
  });

  it.each([
    ["cancelled", "отменена"],
    ["moved-from", "перенесена"],
  ] as const)(
    "изменение %s не превращается в обещание начала пары",
    async (status, relativeTime) => {
      const now = "2026-11-05T12:06:00Z";
      const changed = lesson("2026-11-05T12:15:00Z", "2026-11-05T13:45:00Z", {
        status,
      });
      const { context, results } = await inspectSchedule(now, null, null, [
        changed,
      ]);
      expect(context.schedule.changes[0]?.relativeTime).toBe(relativeTime);
      expect(results.changes.changes[0]?.relativeTime).toBe(relativeTime);
      expect(results.week.days[0]?.lessons[0]?.relativeTime).toBe(relativeTime);
    },
  );

  it("изменённая пара после окончания не называется начинающейся сейчас", async () => {
    const now = "2026-11-05T14:00:00Z";
    const past = lesson("2026-11-05T12:15:00Z", "2026-11-05T13:45:00Z");
    const { context, results } = await inspectSchedule(now, null, null, [past]);
    expect(context.schedule.changes[0]?.relativeTime).toBe("завершилась");
    expect(results.changes.changes[0]?.relativeTime).toBe("завершилась");
    expect(results.week.days[0]?.lessons[0]?.relativeTime).toBe("завершилась");
  });

  it.each(["Где следующая пара?", "Что изменилось?"])(
    "ответ без ИИ тоже использует готовое время: %s",
    async (question) => {
      const f = assistantFixture(
        toolRuntime(async () => {
          throw new Error("RUNTIME_UNAVAILABLE");
        }),
      );
      const now = "2026-11-05T12:06:00Z";
      f.clock.set(now);
      const next = lesson("2026-11-05T12:15:00Z", "2026-11-05T13:45:00Z");
      const original = await f.deps.schedule.getToday.execute(f.actor);
      f.deps.schedule.getToday = {
        execute: async () => ({ ...original, next, changes: [next] }),
      };
      const events = await collect(
        await f.ask.execute(f.actor, { action: "ask", threadId, question }),
      );
      expect(events).toContainEqual({ type: "mode", mode: "fallback" });
      expect(events).toContainEqual({
        type: "message",
        code:
          question === "Где следующая пара?" ? "nextLesson" : "changedLesson",
        params: {
          course: next.course,
          room: next.room,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          status: next.status,
          now: original.now,
        },
      });
    },
  );
});
