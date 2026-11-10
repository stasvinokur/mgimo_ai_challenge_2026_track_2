import { beforeEach, expect, it } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import {
  GetTeacherGradebook,
  GradeScoreConflictError,
  GradeScoreRateLimitedError,
  ListTeacherGradebooks,
  SetTeacherGrade,
} from "@/application/teacher/gradebook";
import type {
  GradebookContext,
  GradebookEntry,
  GradebookReadContext,
  TeacherGradebooks,
  TeacherGradebookUnitOfWork,
} from "@/application/teacher/gradebook-ports";
import type { TeacherLesson } from "@/application/teacher/ports";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, FakeRateLimiter, marina } from "../fakes/identity";
import { FakeTeacherScheduleRepository, oleg } from "../fakes/teacher";

const slotId = "00000000-0000-7000-8000-000000000001";
const key = { slotId, occurrenceDate: "2026-11-05" };
const entryKey = "a".repeat(32);
const clock = new FakeClock("2026-11-04T22:00:00Z");
const lesson: TeacherLesson = {
  id: `${slotId}:2026-11-05`,
  uid: "lesson@pulse",
  date: "2026-11-05",
  startsAt: "2026-11-05T06:00:00Z",
  endsAt: "2026-11-05T07:30:00Z",
  room: "ДЕМО-101",
  teacher: "Учебный преподаватель",
  group: "ДЕМО-1",
  course: "Учебная дисциплина",
  kind: "lecture",
  status: "scheduled",
  changes: [],
  revision: 0,
  updatedAt: "2026-11-04T05:00:00Z",
};

class FakeGradebookUnitOfWork implements TeacherGradebookUnitOfWork {
  readonly schedule = new FakeTeacherScheduleRepository();
  readonly calls: string[] = [];
  entry: GradebookEntry = {
    assessmentId: "work",
    studentId: "owned-student",
    studentUserId: "owned-user",
    courseId: "course",
    courseTitle: "Учебная дисциплина",
    workTitle: "Тест",
    maxScore: 100,
    score: null,
  };
  records: Parameters<TeacherGradebooks["recordChange"]>[0][] = [];
  failure = false;
  baseTeacher = true;
  commitError = false;
  reads = 0;
  runs = 0;
  active = false;

  constructor() {
    this.schedule.lessons.set(oleg.teacherId, [lesson]);
  }

  private context(): GradebookContext {
    return {
      teacherSchedule: this.schedule,
      lockLesson: async (key) => {
        this.calls.push(`lesson-lock:${key.slotId}`);
      },
      lockEntry: async (entryKey) => {
        this.calls.push(`lock:${entryKey}`);
      },
      books: {
        isBaseTeacherForLesson: async () => this.baseTeacher,
        readEntryForTeacherLesson: async (_key, _teacherId, entry) =>
          entry === entryKey ? structuredClone(this.entry) : null,
        listForTeacher: async (teacherId, date) => {
          this.calls.push(`list:${teacherId}:${date}`);
          return [{ ...key, course: lesson.course, group: lesson.group }];
        },
        getForTeacherLesson: async (key, teacherId) => {
          this.calls.push(`get:${key.slotId}:${teacherId}`);
          return { courseId: "course", works: [], students: [] };
        },
        findEntryForTeacherLesson: async (key, teacherId, entry) => {
          this.calls.push(`find:${key.slotId}:${teacherId}:${entry}`);
          return entry === entryKey ? this.entry : null;
        },
        recordChange: async (record) => {
          this.calls.push("write");
          this.records.push(structuredClone(record));
          this.entry.score = record.score;
          if (this.failure) throw new Error("Ошибка уведомления");
        },
      },
    };
  }

  async read<T>(
    work: (context: GradebookReadContext) => Promise<T>,
  ): Promise<T> {
    this.reads++;
    this.active = true;
    try {
      return await work(this.context());
    } finally {
      this.active = false;
    }
  }

  async run<T>(work: (context: GradebookContext) => Promise<T>): Promise<T> {
    this.runs++;
    this.active = true;
    const before = structuredClone({
      entry: this.entry,
      records: this.records,
    });
    try {
      const result = await work(this.context());
      if (this.commitError) throw new Error("Ошибка commit");
      return result;
    } catch (error) {
      this.entry = before.entry;
      this.records = before.records;
      throw error;
    } finally {
      this.active = false;
    }
  }
}

beforeEach(() => clock.set("2026-11-04T22:00:00Z"));

function services() {
  const uow = new FakeGradebookUnitOfWork();
  const limiter = new FakeRateLimiter(clock);
  return {
    uow,
    limiter,
    list: new ListTeacherGradebooks(uow, clock),
    get: new GetTeacherGradebook(uow, clock),
    set: new SetTeacherGrade(uow, clock, new SequentialIdGenerator(), limiter),
  };
}

it("все use cases проверяют роль до входа в транзакцию", async () => {
  const s = services();
  for (const actor of [anna, marina]) {
    await expect(s.list.execute(actor)).rejects.toThrow(ForbiddenError);
    await expect(s.get.execute(actor, key)).rejects.toThrow(ForbiddenError);
    await expect(s.set.execute(actor, {})).rejects.toThrow(ForbiddenError);
  }
  expect(s.uow.runs).toBe(0);
});

it("список получает teacherId только из Actor, опорная дата — МСК", async () => {
  const s = services();
  expect((await s.list.execute(oleg)).books).toHaveLength(1);
  expect(s.uow.calls).toEqual([`list:${oleg.teacherId}:2026-11-05`]);
  expect(await s.get.execute(oleg, key)).toEqual({
    lesson,
    courseId: "course",
    works: [],
    students: [],
  });
});

it("чужая пара и чужая ячейка неотличимы от отсутствующих", async () => {
  const s = services();
  const otherKey = { ...key, occurrenceDate: "2026-11-12" };
  await expect(s.get.execute(oleg, otherKey)).rejects.toThrow(NotFoundError);
  await expect(
    s.set.execute(oleg, {
      ...otherKey,
      entryKey,
      score: 80,
      expectedScore: null,
    }),
  ).rejects.toThrow(NotFoundError);
  expect(s.uow.calls).toEqual([]);
  await expect(
    s.set.execute(oleg, {
      ...key,
      entryKey: "b".repeat(32),
      score: 80,
      expectedScore: null,
    }),
  ).rejects.toThrow(NotFoundError);
  expect(s.uow.records).toEqual([]);
});

it("не принимает клиентские studentId, userId, groupId и подмену teacherId", async () => {
  const s = services();
  for (const field of ["studentId", "userId", "groupId", "teacherId"]) {
    await expect(
      s.set.execute(oleg, {
        ...key,
        entryKey,
        score: 80,
        expectedScore: null,
        [field]: "foreign",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      s.get.execute(oleg, { ...key, [field]: "foreign" }),
    ).rejects.toThrow(NotFoundError);
  }
  expect(s.uow.runs).toBe(0);
});

it("блокирует ячейку до чтения, фиксирует авторство/время и сохраняет повтор без события", async () => {
  const s = services();
  const input = { ...key, entryKey, score: 80, expectedScore: null };
  await expect(s.set.execute(oleg, input)).resolves.toEqual({
    changed: true,
    courseId: "course",
  });
  expect(s.uow.calls).toEqual([
    `lock:${entryKey}`,
    `lesson-lock:${slotId}`,
    `find:${slotId}:${oleg.teacherId}:${entryKey}`,
    "write",
  ]);
  expect(s.uow.records[0]).toMatchObject({
    entry: { score: null, studentId: "owned-student" },
    score: 80,
    reason: null,
    changedByUserId: oleg.userId,
    at: "2026-11-04T22:00:00.000Z",
  });
  expect(s.uow.records[0]?.eventId).not.toBe(s.uow.records[0]?.notificationId);
  await expect(
    s.set.execute(oleg, { ...input, expectedScore: 80 }),
  ).resolves.toEqual({
    changed: false,
    courseId: "course",
  });
  expect(s.uow.records).toHaveLength(1);
  await expect(
    s.set.execute(oleg, { ...input, score: 90, expectedScore: 80 }),
  ).rejects.toThrow(ValidationError);
  await s.set.execute(oleg, {
    ...input,
    score: 90,
    expectedScore: 80,
    reason: "appeal_review",
  });
  expect(s.uow.records[1]).toMatchObject({
    entry: { score: 80 },
    score: 90,
    reason: "appeal_review",
  });
});

it("сбой внутри UoW откатывает балл и запись истории", async () => {
  const s = services();
  s.uow.failure = true;
  await expect(
    s.set.execute(oleg, { ...key, entryKey, score: 80, expectedScore: null }),
  ).rejects.toThrow("Ошибка уведомления");
  expect(s.uow.entry.score).toBeNull();
  expect(s.uow.records).toEqual([]);
  expect(s.limiter.attempts.size).toBe(0);
});

it("две вкладки с устаревшим expectedScore не перезаписывают балл и не тратят квоту", async () => {
  const s = services();
  const input = { ...key, entryKey, score: 80, expectedScore: null };
  await s.set.execute(oleg, input);
  await expect(
    s.set.execute(oleg, { ...input, score: 90, reason: "entry_error" }),
  ).rejects.toThrow(GradeScoreConflictError);
  await expect(
    s.set.execute(oleg, { ...input, score: 90, reason: "entry_error" }),
  ).rejects.toThrow("Балл уже изменили, обновите ведомость");
  expect(s.uow.entry.score).toBe(80);
  expect(s.uow.records).toHaveLength(1);
  expect(
    s.limiter.attempts.get(`grades:teacher:${oleg.teacherId}`),
  ).toHaveLength(1);
});

it("expectedScore обязателен, произвольная или пустая причина не проходят schema", async () => {
  const s = services();
  await expect(
    s.set.execute(oleg, { ...key, entryKey, score: 80 }),
  ).rejects.toThrow(ValidationError);
  for (const reason of ["", "retake ", "Свободный текст", "other"])
    await expect(
      s.set.execute(oleg, {
        ...key,
        entryKey,
        score: 80,
        expectedScore: null,
        reason,
      }),
    ).rejects.toThrow(ValidationError);
  expect(s.uow.runs).toBe(0);
  expect(s.limiter.attempts.size).toBe(0);
});

it("30 реальных изменений за 15 минут, no-op/ошибки не расходуют квоту; граница окна освобождается", async () => {
  const s = services();
  for (let score = 0; score < 30; score++)
    await s.set.execute(oleg, {
      ...key,
      entryKey,
      score,
      expectedScore: score ? score - 1 : null,
      reason: "entry_error",
    });
  await expect(
    s.set.execute(oleg, { ...key, entryKey, score: 29, expectedScore: 29 }),
  ).resolves.toMatchObject({ changed: false });
  await expect(
    s.set.execute(oleg, {
      ...key,
      entryKey,
      score: 30,
      expectedScore: 29,
      reason: "entry_error",
    }),
  ).rejects.toThrow(GradeScoreRateLimitedError);
  await expect(
    s.set.execute(oleg, {
      ...key,
      entryKey,
      score: 30,
      expectedScore: 29,
      reason: "entry_error",
    }),
  ).rejects.toThrow(
    "Слишком много изменений баллов. Попробуйте через 15 минут",
  );
  expect(s.uow.records).toHaveLength(30);
  expect(s.uow.entry.score).toBe(29);
  clock.advance(900_000);
  await expect(
    s.set.execute(oleg, {
      ...key,
      entryKey,
      score: 30,
      expectedScore: 29,
      reason: "entry_error",
    }),
  ).resolves.toMatchObject({ changed: true });
});

it("сбой commit после callback возвращает резерв квоты", async () => {
  const s = services();
  s.uow.commitError = true;
  await expect(
    s.set.execute(oleg, { ...key, entryKey, score: 80, expectedScore: null }),
  ).rejects.toThrow("Ошибка commit");
  expect(s.uow.entry.score).toBeNull();
  expect(s.limiter.attempts.size).toBe(0);
});

it("чтение не вызывает блокировки записи; окно замещения определяется московской датой", async () => {
  const s = services();
  await s.get.execute(oleg, key);
  expect(s.uow.reads).toBe(1);
  expect(s.uow.calls.some((call) => call.includes("lock"))).toBe(false);
  s.uow.baseTeacher = false;
  for (const [instant, allowed] of [
    ["2026-11-04T20:59:59.999Z", false],
    ["2026-11-04T21:00:00Z", true],
    ["2026-11-11T20:59:59.999Z", true],
    ["2026-11-11T21:00:00Z", false],
  ] as const) {
    clock.set(instant);
    if (allowed)
      await expect(s.get.execute(oleg, key)).resolves.toMatchObject({
        courseId: "course",
      });
    else await expect(s.get.execute(oleg, key)).rejects.toThrow(NotFoundError);
  }
  s.uow.baseTeacher = true;
  clock.set("2027-01-01T09:00:00Z");
  await expect(s.get.execute(oleg, key)).resolves.toMatchObject({
    courseId: "course",
  });
});

it("reserve и settle происходят между транзакциями, после завершённого preflight и commit", async () => {
  const s = services();
  const events: string[] = [];
  const uow: TeacherGradebookUnitOfWork = {
    async read(work) {
      events.push("read:start");
      const result = await s.uow.read(work);
      events.push("read:end");
      return result;
    },
    async run(work) {
      events.push("write:start");
      try {
        return await s.uow.run(work);
      } finally {
        events.push("write:end");
      }
    },
  };
  const set = new SetTeacherGrade(uow, clock, new SequentialIdGenerator(), {
    async reserve(rules) {
      expect(s.uow.active).toBe(false);
      events.push("reserve");
      const reservation = await s.limiter.reserve(rules);
      if (!reservation) return null;
      return {
        async commitFailure() {
          expect(s.uow.active).toBe(false);
          events.push("keep");
          await reservation.commitFailure();
        },
        async release() {
          expect(s.uow.active).toBe(false);
          events.push("release");
          await reservation.release();
        },
      };
    },
  });
  await set.execute(oleg, { ...key, entryKey, score: 80, expectedScore: null });
  expect(events).toEqual([
    "read:start",
    "read:end",
    "reserve",
    "write:start",
    "write:end",
    "keep",
  ]);
  events.length = 0;
  s.uow.failure = true;
  await expect(
    set.execute(oleg, {
      ...key,
      entryKey,
      score: 90,
      expectedScore: 80,
      reason: "entry_error",
    }),
  ).rejects.toThrow("Ошибка уведомления");
  expect(events).toEqual([
    "read:start",
    "read:end",
    "reserve",
    "write:start",
    "write:end",
    "release",
  ]);
  events.length = 0;
  s.uow.failure = false;
  await set.execute(oleg, { ...key, entryKey, score: 80, expectedScore: 80 });
  expect(events).toEqual([
    "read:start",
    "read:end",
    "write:start",
    "write:end",
  ]);
  expect(
    s.limiter.attempts.get(`grades:teacher:${oleg.teacherId}`),
  ).toHaveLength(1);
});
