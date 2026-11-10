import { expect, it, vi } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { SetTeacherGrade } from "@/application/teacher/gradebook";
import type {
  GradebookContext,
  GradebookEntry,
  TeacherGradebooks,
  TeacherGradebookUnitOfWork,
} from "@/application/teacher/gradebook-ports";
import type { TeacherLesson } from "@/application/teacher/ports";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, FakeRateLimiter, marina } from "../fakes/identity";
import { FakeTeacherScheduleRepository, oleg } from "../fakes/teacher";

const key = {
  slotId: "00000000-0000-7000-8000-000000000011",
  occurrenceDate: "2026-11-05",
};
const entryKey = "a".repeat(32);
const input = { ...key, entryKey, score: 80, expectedScore: null };

function fixture() {
  const clock = new FakeClock("2026-11-05T09:00:00Z");
  const limiter = new FakeRateLimiter(clock);
  const schedule = new FakeTeacherScheduleRepository();
  const lesson: TeacherLesson = {
    id: `${key.slotId}:${key.occurrenceDate}`,
    uid: "grade-push@pulse",
    date: key.occurrenceDate,
    startsAt: "2026-11-05T09:00:00Z",
    endsAt: "2026-11-05T10:30:00Z",
    room: "ДЕМО-101",
    teacher: "Учебный преподаватель",
    group: "ДЕМО-1",
    course: "Учебная дисциплина",
    kind: "lecture",
    status: "scheduled",
    changes: [],
    revision: 0,
    updatedAt: "2026-11-05T06:00:00Z",
  };
  schedule.lessons.set(oleg.teacherId, [lesson]);
  const state = {
    entry: {
      assessmentId: "work",
      studentId: "student-from-database",
      studentUserId: "user-from-database",
      courseId: "course",
      courseTitle: "Учебная дисциплина",
      workTitle: "Тест",
      maxScore: 100,
      score: null,
    } as GradebookEntry,
    records: [] as Parameters<TeacherGradebooks["recordChange"]>[0][],
    active: false,
    failWrite: false,
    failCommit: false,
    beforeCommit: undefined as (() => Promise<void>) | undefined,
    events: [] as string[],
  };
  const books: TeacherGradebooks = {
    async isBaseTeacherForLesson() {
      return true;
    },
    async listForTeacher() {
      return [];
    },
    async getForTeacherLesson() {
      return { courseId: "course", works: [], students: [] };
    },
    async readEntryForTeacherLesson(_key, _teacherId, requested) {
      return requested === entryKey ? structuredClone(state.entry) : null;
    },
    async findEntryForTeacherLesson(_key, _teacherId, requested) {
      return requested === entryKey ? state.entry : null;
    },
    async recordChange(record) {
      state.events.push("write");
      state.records.push(structuredClone(record));
      state.entry.score = record.score;
      if (state.failWrite) throw new Error("TEST_WRITE_FAILED");
    },
  };
  const context: GradebookContext = {
    books,
    teacherSchedule: schedule,
    async lockEntry() {},
    async lockLesson() {},
  };
  const uow: TeacherGradebookUnitOfWork = {
    async read(work) {
      state.active = true;
      try {
        return await work(context);
      } finally {
        state.active = false;
      }
    },
    async run(work) {
      const before = structuredClone({
        entry: state.entry,
        records: state.records,
      });
      state.active = true;
      try {
        const result = await work(context);
        await state.beforeCommit?.();
        if (state.failCommit) throw new Error("TEST_COMMIT_FAILED");
        state.events.push("commit");
        return result;
      } catch (error) {
        state.entry = before.entry;
        state.records = before.records;
        throw error;
      } finally {
        state.active = false;
      }
    },
  };
  return {
    state,
    limiter,
    set: new SetTeacherGrade(uow, clock, new SequentialIdGenerator(), limiter),
  };
}

it("серверный получатель берётся из записи БД и возвращается только после commit и учёта квоты", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.state.beforeCommit = async () => {
    entered.resolve();
    await release.promise;
  };
  const reserve = f.limiter.reserve.bind(f.limiter);
  vi.spyOn(f.limiter, "reserve").mockImplementation(async (rules) => {
    const reservation = await reserve(rules);
    if (!reservation) return null;
    return {
      async commitFailure() {
        expect(f.state.active).toBe(false);
        f.state.events.push("quota-kept");
        await reservation.commitFailure();
      },
      release: () => reservation.release(),
    };
  });
  let returned = false;
  const work = f.set.executeWithRecipient(oleg, input).then((result) => {
    returned = true;
    f.state.events.push("returned");
    return result;
  });
  try {
    await entered.promise;
    expect(returned).toBe(false);
    expect(f.state.events).toEqual(["write"]);
  } finally {
    release.resolve();
  }
  expect(await work).toEqual({
    changed: true,
    courseId: "course",
    pushRecipient: { userId: "user-from-database", ...key, entryKey },
  });
  expect(f.state.events).toEqual(["write", "commit", "quota-kept", "returned"]);
});

it("прежний execute возвращает ровно прежний результат без серверного id", async () => {
  const f = fixture();
  expect(await f.set.execute(oleg, input)).toEqual({
    changed: true,
    courseId: "course",
  });
});

it("исправление балла также возвращает получателя из сохранённой строки", async () => {
  const f = fixture();
  await f.set.executeWithRecipient(oleg, input);
  const result = await f.set.executeWithRecipient(oleg, {
    ...input,
    score: 90,
    expectedScore: 80,
    reason: "appeal_review",
  });
  expect(result).toEqual({
    changed: true,
    courseId: "course",
    pushRecipient: { userId: "user-from-database", ...key, entryKey },
  });
  expect(f.state.records).toHaveLength(2);
});

it("повтор без изменения не получает адресата push и не создаёт уведомление", async () => {
  const f = fixture();
  f.state.entry.score = 80;
  expect(
    await f.set.executeWithRecipient(oleg, { ...input, expectedScore: 80 }),
  ).toEqual({
    changed: false,
    courseId: "course",
    pushRecipient: null,
  });
  expect(f.state.records).toEqual([]);
  expect(f.limiter.attempts.size).toBe(0);
});

it("студент без аккаунта получает записанный балл без адресата push", async () => {
  const f = fixture();
  f.state.entry.studentUserId = null;
  expect(await f.set.executeWithRecipient(oleg, input)).toEqual({
    changed: true,
    courseId: "course",
    pushRecipient: null,
  });
  expect(f.state.records).toHaveLength(1);
});

it.each(["write", "commit"] as const)(
  "отказ %s не выдаёт адресата и откатывает запись",
  async (stage) => {
    const f = fixture();
    if (stage === "write") f.state.failWrite = true;
    else f.state.failCommit = true;
    await expect(f.set.executeWithRecipient(oleg, input)).rejects.toThrow(
      stage === "write" ? "TEST_WRITE_FAILED" : "TEST_COMMIT_FAILED",
    );
    expect(f.state.entry.score).toBeNull();
    expect(f.state.records).toEqual([]);
    expect(f.limiter.attempts.size).toBe(0);
  },
);

it.each([anna, marina])(
  "роль $kind не получает серверный адресат",
  async (actor) => {
    const f = fixture();
    await expect(f.set.executeWithRecipient(actor, input)).rejects.toThrow(
      ForbiddenError,
    );
    expect(f.state.events).toEqual([]);
  },
);

it("чужая ячейка и недопустимый балл не выдают адресата", async () => {
  const f = fixture();
  await expect(
    f.set.executeWithRecipient(oleg, { ...input, entryKey: "b".repeat(32) }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    f.set.executeWithRecipient(oleg, { ...input, score: 101 }),
  ).rejects.toThrow(ValidationError);
  expect(f.state.events).toEqual([]);
});

it.each(["userId", "studentUserId", "studentId", "pushRecipient"])(
  "клиентское поле %s отвергается до записи",
  async (field) => {
    const f = fixture();
    await expect(
      f.set.executeWithRecipient(oleg, { ...input, [field]: "forged-user" }),
    ).rejects.toThrow(ValidationError);
    expect(f.state.records).toEqual([]);
    expect(f.state.events).toEqual([]);
  },
);
