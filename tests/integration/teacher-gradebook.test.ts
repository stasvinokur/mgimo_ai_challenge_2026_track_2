import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  GetCourseGrades,
  GetMyGrades,
} from "@/application/grades/get-my-grades";
import type { IdGenerator } from "@/application/ports/id-generator";
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
import type { TeacherGradebookUnitOfWork } from "@/application/teacher/gradebook-ports";
import { addDays } from "@/domain/schedule/dates";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresTeacherGradebookUnitOfWork } from "@/infrastructure/db/repositories/teacher/gradebook";
import { FakeClock } from "../fakes/clock";
import { marina } from "../fakes/identity";
import { openTeacherTestData } from "./teacher-e2e-data";
import {
  openTeacherGradesTestData,
  type TeacherGradesTestData,
  teacherGradeEntryKey,
} from "./teacher-grades-data";

let fixture: TeacherGradesTestData;
const clock = new FakeClock("2026-11-05T09:00:00Z");

beforeAll(async () => {
  fixture = await openTeacherGradesTestData();
});
beforeEach(async () => {
  clock.set(`${fixture.key.occurrenceDate}T09:00:00Z`);
  const { teacher, workId, secondWorkId, student, courseId } = fixture;
  const { sql, ids } = teacher;
  await sql.begin(async (tx) => {
    await tx`delete from login_attempts where key = ${`grades:teacher:${teacher.actor.teacherId}`}`;
    await tx`delete from scores where assessment_id = ${workId}`;
    await tx`delete from score_events where assessment_id in (${workId}, ${secondWorkId})`;
    await tx`delete from notifications where link = ${`/grades/${courseId}`}`;
    await tx`insert into scores (id, assessment_id, student_id, score, graded_at)
      values (${ids.next()}, ${secondWorkId}, ${student.actor.studentId}, 88, '2026-11-01T09:00:00Z')
      on conflict (student_id, assessment_id) do update set score = 88, graded_at = excluded.graded_at`;
  });
});
afterAll(async () => {
  if (fixture) {
    await fixture.teacher
      .sql`delete from login_attempts where key = ${`grades:teacher:${fixture.teacher.actor.teacherId}`}`;
    await fixture.close();
  }
});

function services(f = fixture, changeIds: IdGenerator = f.teacher.ids) {
  const uow = new PostgresTeacherGradebookUnitOfWork(
    () => f.teacher.sql,
    f.teacher.ids,
  );
  return {
    list: new ListTeacherGradebooks(uow, clock),
    get: new GetTeacherGradebook(uow, clock),
    set: new SetTeacherGrade(
      uow,
      clock,
      changeIds,
      new PostgresRateLimiter(() => f.teacher.sql, clock, f.teacher.ids),
    ),
  };
}

function setInput(
  score: number,
  reason?: string,
  expectedScore: number | null = null,
) {
  return {
    ...fixture.key,
    entryKey: fixture.entryKey,
    score,
    expectedScore,
    ...(reason === undefined ? {} : { reason }),
  };
}

async function quota(teacherId = fixture.teacher.actor.teacherId) {
  const [row] = await fixture.teacher.sql<
    { count: number }[]
  >`select count(*)::int as count from login_attempts where key = ${`grades:teacher:${teacherId}`}`;
  return row?.count ?? 0;
}

async function snapshot() {
  const { sql } = fixture.teacher;
  const scores = await sql`
    select student_id, score, graded_at from scores
    where assessment_id = ${fixture.workId} order by student_id`;
  const events = await sql`
    select previous_score, new_score, changed_by_user_id, reason, created_at
    from score_events where assessment_id = ${fixture.workId} order by created_at, id`;
  const notifications = await sql`
    select user_id, title, body, link, created_at from notifications
    where link = ${`/grades/${fixture.courseId}`} order by created_at, id`;
  return {
    scores: [...scores],
    events: [...events],
    notifications: [...notifications],
  };
}

it("ведомость привязана к паре, показывает только работы её курса/группы и минимальный состав студентов", async () => {
  const s = services();
  const list = await s.list.execute(fixture.teacher.actor);
  expect(list.books).toEqual([
    {
      ...fixture.key,
      course: fixture.courseTitle,
      group: expect.any(String),
    },
  ]);
  const book = await s.get.execute(fixture.teacher.actor, fixture.key);
  expect(book.courseId).toBe(fixture.courseId);
  expect(book.works.map((work) => work.id)).toEqual([
    fixture.workId,
    fixture.secondWorkId,
  ]);
  expect(book.students).toHaveLength(3);
  for (const row of book.students) {
    expect(Object.keys(row).sort()).toEqual([
      "entries",
      "fullName",
      "group",
      "key",
    ]);
    expect(row.entries).toHaveLength(2);
    for (const entry of row.entries)
      expect(Object.keys(entry).sort()).toEqual([
        "assessmentId",
        "key",
        "score",
      ]);
  }
  expect(JSON.stringify(book.students)).not.toContain(
    fixture.student.actor.studentId,
  );
  expect(JSON.stringify(book.students)).not.toContain(
    fixture.student.actor.userId,
  );
  const row = book.students.find((row) => row.fullName === "Студент ведомости");
  expect(row?.entries).toContainEqual({
    key: fixture.entryKey,
    assessmentId: fixture.workId,
    score: null,
  });
});

it("выставление, повтор и исправление пишут согласованную историю/уведомление; итог и стипендия пересчитываются", async () => {
  const s = services();
  const grades = new PostgresGradesRepository(() => fixture.teacher.sql);
  const getCourse = new GetCourseGrades(grades, clock);
  const getGrades = new GetMyGrades(grades, clock);
  const before = await getCourse.execute(fixture.student.actor, {
    courseId: fixture.courseId,
  });
  expect(before.course.currentScore).toBe(88);
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(80)),
  ).resolves.toEqual({
    changed: true,
    courseId: fixture.courseId,
  });
  const first = await snapshot();
  expect(first.events).toHaveLength(1);
  expect(first.events[0]).toMatchObject({
    previous_score: null,
    new_score: 80,
    changed_by_user_id: fixture.teacher.actor.userId,
    reason: null,
    created_at: clock.now(),
  });
  expect(first.notifications).toHaveLength(1);
  expect(first.notifications[0]).toMatchObject({
    user_id: fixture.student.actor.userId,
    title: `Новая оценка: ${fixture.courseTitle} — ${fixture.workTitle}`,
    link: `/grades/${fixture.courseId}`,
  });
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(80, undefined, 80)),
  ).resolves.toMatchObject({
    changed: false,
  });
  expect(await snapshot()).toEqual(first);
  for (const reason of ["", " \n ", "я".repeat(301)])
    await expect(
      s.set.execute(fixture.teacher.actor, setInput(90, reason, 80)),
    ).rejects.toThrow(ValidationError);
  expect(await snapshot()).toEqual(first);
  expect(
    (
      await getCourse.execute(fixture.student.actor, {
        courseId: fixture.courseId,
      })
    ).course.secured,
  ).toBe(84);
  const regular = await getGrades.execute(fixture.student.actor);
  clock.advance(1_000);
  await s.set.execute(fixture.teacher.actor, setInput(90, "appeal_review", 80));
  const second = await snapshot();
  expect(second.events).toHaveLength(2);
  expect(second.events[1]).toMatchObject({
    previous_score: 80,
    new_score: 90,
    reason: "appeal_review",
  });
  expect(second.notifications).toHaveLength(2);
  expect(second.notifications[1]?.body).toContain("Пересмотр после апелляции");
  expect(second.notifications[1]?.body).not.toContain("appeal_review");
  expect(
    (
      await getCourse.execute(fixture.student.actor, {
        courseId: fixture.courseId,
      })
    ).course.secured,
  ).toBe(89);
  const increased = await getGrades.execute(fixture.student.actor);
  expect(regular.scholarship).not.toEqual(increased.scholarship);
});

it("сбой записи уведомления после балла и score_events откатывает все три таблицы", async () => {
  const { sql, ids } = fixture.teacher;
  const existingId = ids.next();
  await sql`insert into notifications (id, user_id, kind, title, body, link)
    values (${existingId}, ${fixture.student.actor.userId}, 'change', 'Учебное уведомление', 'Проверка отката', ${`/grades/${fixture.courseId}`})`;
  const before = await snapshot();
  const eventId = ids.next();
  let generated = 0;
  const s = services(fixture, {
    next: () => (++generated === 1 ? eventId : existingId),
  });
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(80)),
  ).rejects.toMatchObject({
    code: "23505",
  });
  expect(await snapshot()).toEqual(before);
  expect(await quota()).toBe(0);
  expect(
    await sql`select id from score_events where id = ${eventId}`,
  ).toHaveLength(0);
});

it("сбой score_events после обновления балла откатывает изменение и не создаёт уведомление", async () => {
  const s = services();
  await s.set.execute(fixture.teacher.actor, setInput(80));
  const { sql, ids } = fixture.teacher;
  const [event] = await sql<{ id: string }[]>`
    select id from score_events where assessment_id = ${fixture.workId}`;
  if (!event) throw new Error("Не создано событие проверки.");
  const before = await snapshot();
  let generated = 0;
  const failing = services(fixture, {
    next: () => (++generated === 1 ? event.id : ids.next()),
  });
  await expect(
    failing.set.execute(fixture.teacher.actor, setInput(90, "entry_error", 80)),
  ).rejects.toMatchObject({ code: "23505" });
  expect(await snapshot()).toEqual(before);
  expect(await quota()).toBe(1);
});

it("две вкладки не перезаписывают балл: одна запись и один optimistic conflict без лишней квоты", async () => {
  const s = services();
  const results = await Promise.allSettled([
    s.set.execute(fixture.teacher.actor, setInput(80)),
    s.set.execute(fixture.teacher.actor, setInput(80)),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.reason).toBeInstanceOf(GradeScoreConflictError);
  const result = await snapshot();
  expect(result.scores).toHaveLength(1);
  expect(result.events).toHaveLength(1);
  expect(result.notifications).toHaveLength(1);
  expect(await quota()).toBe(1);
});

it("чужие роль, курс, группа и студент не дают прочитать или изменить ведомость", async () => {
  const other = await openTeacherGradesTestData();
  try {
    const s = services();
    for (const actor of [fixture.student.actor, marina]) {
      await expect(s.list.execute(actor)).rejects.toThrow(ForbiddenError);
      await expect(s.get.execute(actor, fixture.key)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(s.set.execute(actor, setInput(80))).rejects.toThrow(
        ForbiddenError,
      );
    }
    await expect(
      s.get.execute(other.teacher.actor, fixture.key),
    ).rejects.toThrow(NotFoundError);
    await expect(
      s.set.execute(other.teacher.actor, setInput(80)),
    ).rejects.toThrow(NotFoundError);
    for (const entryKey of [
      other.entryKey,
      teacherGradeEntryKey(fixture.workId, other.student.actor.studentId),
      teacherGradeEntryKey(other.workId, fixture.student.actor.studentId),
    ])
      await expect(
        s.set.execute(fixture.teacher.actor, { ...setInput(80), entryKey }),
      ).rejects.toThrow(NotFoundError);
    expect(await snapshot()).toEqual({
      scores: [],
      events: [],
      notifications: [],
    });
    expect(
      (await s.get.execute(fixture.teacher.actor, fixture.key)).students,
    ).toHaveLength(3);
  } finally {
    await other.close();
  }
});

it("право исправить балл следует эффективной замене по id, а не имени преподавателя", async () => {
  const replacement = await openTeacherTestData({
    fullName: "Преподаватель ведомости",
  });
  const { sql, ids } = fixture.teacher;
  const changeId = ids.next();
  try {
    await sql`insert into schedule_changes (id, slot_id, date, kind, new_teacher_id, reason)
      values (${changeId}, ${fixture.key.slotId}, ${fixture.key.occurrenceDate}, 'replaced', ${replacement.actor.teacherId}, 'Учебная замена')`;
    const s = services();
    clock.set(`${addDays(fixture.key.occurrenceDate, -1)}T20:59:59.999Z`);
    await expect(s.get.execute(replacement.actor, fixture.key)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      s.set.execute(replacement.actor, setInput(80)),
    ).rejects.toThrow(NotFoundError);
    clock.set(`${addDays(fixture.key.occurrenceDate, -1)}T21:00:00Z`);
    await expect(
      s.get.execute(fixture.teacher.actor, fixture.key),
    ).rejects.toThrow(NotFoundError);
    await expect(
      s.set.execute(fixture.teacher.actor, setInput(80)),
    ).rejects.toThrow(NotFoundError);
    expect((await s.get.execute(replacement.actor, fixture.key)).courseId).toBe(
      fixture.courseId,
    );
    expect((await s.list.execute(replacement.actor)).books).toContainEqual({
      ...fixture.key,
      course: fixture.courseTitle,
      group: expect.any(String),
    });
    await s.set.execute(replacement.actor, setInput(80));
    expect((await snapshot()).events[0]).toMatchObject({
      changed_by_user_id: replacement.actor.userId,
    });
    clock.set(`${addDays(fixture.key.occurrenceDate, 6)}T20:59:59.999Z`);
    await expect(
      s.get.execute(replacement.actor, fixture.key),
    ).resolves.toMatchObject({ courseId: fixture.courseId });
    await s.set.execute(replacement.actor, setInput(81, "entry_error", 80));
    clock.set(`${addDays(fixture.key.occurrenceDate, 6)}T21:00:00Z`);
    await expect(s.get.execute(replacement.actor, fixture.key)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      s.set.execute(replacement.actor, setInput(82, "entry_error", 81)),
    ).rejects.toThrow(NotFoundError);
    expect(
      (await s.list.execute(replacement.actor)).books.some(
        (book) => book.course === fixture.courseTitle,
      ),
    ).toBe(false);
    await expect(
      s.get.execute(fixture.teacher.actor, {
        ...fixture.key,
        occurrenceDate: addDays(fixture.key.occurrenceDate, 7),
      }),
    ).resolves.toMatchObject({ courseId: fixture.courseId });
    await sql`update schedule_changes set new_teacher_id = ${fixture.teacher.actor.teacherId} where id = ${changeId}`;
    await expect(s.get.execute(replacement.actor, fixture.key)).rejects.toThrow(
      NotFoundError,
    );
  } finally {
    await sql`delete from schedule_changes where id = ${changeId}`;
    await sql`delete from login_attempts where key = ${`grades:teacher:${replacement.actor.teacherId}`}`;
    await replacement.close();
  }
});

it("чужие GET и действие возвращают NotFound без ожидания блокировки чужой пары", async () => {
  const other = await openTeacherTestData();
  try {
    await fixture.teacher.sql.begin(async (tx) => {
      await tx`select id from schedule_slots where id = ${fixture.key.slotId} for update`;
      const s = services();
      await expect(s.get.execute(other.actor, fixture.key)).rejects.toThrow(
        NotFoundError,
      );
      await expect(s.set.execute(other.actor, setInput(80))).rejects.toThrow(
        NotFoundError,
      );
    });
  } finally {
    await other.close();
  }
});

it("read-only ведомость использует единый repeatable-read снимок без блокировки изменения расписания", async () => {
  const other = await openTeacherTestData();
  const { sql, ids } = fixture.teacher;
  const base = new PostgresTeacherGradebookUnitOfWork(() => sql, ids);
  const guarded: TeacherGradebookUnitOfWork = {
    run: (work) => base.run(work),
    read: (work) =>
      base.read((context) =>
        work({
          ...context,
          teacherSchedule: {
            listForTeacher: (...args) =>
              context.teacherSchedule.listForTeacher(...args),
            async findLessonForTeacher(...args) {
              const lesson = await context.teacherSchedule.findLessonForTeacher(
                ...args,
              );
              await sql.begin(async (tx) => {
                await tx`set local lock_timeout = '100ms'`;
                await tx`update schedule_slots set teacher_id = ${other.actor.teacherId} where id = ${fixture.key.slotId}`;
              });
              return lesson;
            },
          },
        }),
      ),
  };
  try {
    const result = await new GetTeacherGradebook(guarded, clock).execute(
      fixture.teacher.actor,
      fixture.key,
    );
    expect(result.courseId).toBe(fixture.courseId);
    expect(result.students).toHaveLength(3);
    await expect(
      services().get.execute(fixture.teacher.actor, fixture.key),
    ).rejects.toThrow(NotFoundError);
  } finally {
    await sql`update schedule_slots set teacher_id = ${fixture.teacher.actor.teacherId} where id = ${fixture.key.slotId}`;
    await other.close();
  }
});

it("реальный PostgreSQL limiter: только 30 изменений, no-op/conflict/validation вне квоты, ровно через 900 секунд лимит отпускает", async () => {
  const s = services();
  for (let score = 0; score < 30; score++)
    await s.set.execute(
      fixture.teacher.actor,
      setInput(score, "entry_error", score ? score - 1 : null),
    );
  expect(await quota()).toBe(30);
  const before = await snapshot();
  await expect(
    s.set.execute(fixture.teacher.actor, {
      ...setInput(30, "entry_error", 29),
      entryKey: "0".repeat(32),
    }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(29, undefined, 29)),
  ).resolves.toMatchObject({ changed: false });
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(30, "entry_error", 0)),
  ).rejects.toThrow(GradeScoreConflictError);
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(30, undefined, 29)),
  ).rejects.toThrow(ValidationError);
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(30, "entry_error", 29)),
  ).rejects.toThrow(GradeScoreRateLimitedError);
  expect(await snapshot()).toEqual(before);
  expect(await quota()).toBe(30);
  clock.advance(899_999);
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(30, "entry_error", 29)),
  ).rejects.toThrow(GradeScoreRateLimitedError);
  clock.advance(1);
  await expect(
    s.set.execute(fixture.teacher.actor, setInput(30, "entry_error", 29)),
  ).resolves.toMatchObject({ changed: true });
  expect((await snapshot()).events).toHaveLength(31);
});

it("один общий PostgreSQL connection обслуживает preflight, limiter, запись и release без deadlock", async () => {
  const single = createDatabase(1);
  const { ids } = fixture.teacher;
  const set = new SetTeacherGrade(
    new PostgresTeacherGradebookUnitOfWork(() => single, ids),
    clock,
    ids,
    new PostgresRateLimiter(() => single, clock, ids),
  );
  try {
    await expect(
      set.execute(fixture.teacher.actor, setInput(80)),
    ).resolves.toMatchObject({ changed: true });
    const [event] = await single<{ id: string }[]>`
      select id from score_events where assessment_id = ${fixture.workId}`;
    if (!event) throw new Error("Не создано событие проверки.");
    const failing = new SetTeacherGrade(
      new PostgresTeacherGradebookUnitOfWork(() => single, ids),
      clock,
      { next: () => event.id },
      new PostgresRateLimiter(() => single, clock, ids),
    );
    await expect(
      failing.execute(fixture.teacher.actor, setInput(90, "entry_error", 80)),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      set.execute(fixture.teacher.actor, setInput(90, "entry_error")),
    ).rejects.toThrow(GradeScoreConflictError);
    await expect(
      set.execute(fixture.teacher.actor, setInput(80, undefined, 80)),
    ).resolves.toMatchObject({ changed: false });
    expect(await quota()).toBe(1);
    expect((await snapshot()).events).toHaveLength(1);
  } finally {
    await single.end({ timeout: 1 });
  }
});

it("после проверки владения курс, группа и замена не меняются до завершения транзакции", async () => {
  const replacement = await openTeacherTestData();
  const { sql, ids } = fixture.teacher;
  const changeId = ids.next();
  const insertedChangeId = ids.next();
  const authorized = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  try {
    await sql`insert into schedule_changes (id, slot_id, date, kind, new_teacher_id, reason)
      values (${changeId}, ${fixture.key.slotId}, ${fixture.key.occurrenceDate}, 'replaced', ${fixture.teacher.actor.teacherId}, 'Учебная замена')`;
    const base = new PostgresTeacherGradebookUnitOfWork(() => sql, ids);
    let ownershipChecks = 0;
    const guarded: TeacherGradebookUnitOfWork = {
      read: (work) => base.read(work),
      run: (work) =>
        base.run((context) =>
          work({
            ...context,
            teacherSchedule: {
              listForTeacher: (...args) =>
                context.teacherSchedule.listForTeacher(...args),
              async findLessonForTeacher(...args) {
                const lesson =
                  await context.teacherSchedule.findLessonForTeacher(...args);
                if (++ownershipChecks === 2) {
                  authorized.resolve();
                  await resume.promise;
                }
                return lesson;
              },
            },
          }),
        ),
    };
    const running = new SetTeacherGrade(
      guarded,
      clock,
      ids,
      new PostgresRateLimiter(() => sql, clock, ids),
    ).execute(fixture.teacher.actor, setInput(80));
    try {
      await Promise.race([
        authorized.promise,
        running.then(() => {
          throw new Error("Не достигнута проверка владения.");
        }),
      ]);
      for (const action of [
        async () =>
          sql.begin(async (tx) => {
            await tx`set local lock_timeout = '100ms'`;
            await tx`update schedule_slots set teacher_id = ${replacement.actor.teacherId}, group_id = ${replacement.groupId} where id = ${fixture.key.slotId}`;
          }),
        async () =>
          sql.begin(async (tx) => {
            await tx`set local lock_timeout = '100ms'`;
            await tx`update schedule_changes set new_teacher_id = ${replacement.actor.teacherId} where id = ${changeId}`;
          }),
        async () =>
          sql.begin(async (tx) => {
            await tx`set local lock_timeout = '100ms'`;
            await tx`insert into schedule_changes (id, slot_id, date, kind, new_teacher_id, reason)
            values (${insertedChangeId}, ${fixture.key.slotId}, ${fixture.key.occurrenceDate}, 'replaced', ${replacement.actor.teacherId}, 'Учебная замена')`;
          }),
      ])
        await expect(action()).rejects.toMatchObject({ code: "55P03" });
    } finally {
      resume.resolve();
      await running;
    }
    expect((await snapshot()).events).toHaveLength(1);
    await sql`update schedule_changes set new_teacher_id = ${replacement.actor.teacherId} where id = ${changeId}`;
    await expect(
      services().get.execute(fixture.teacher.actor, fixture.key),
    ).rejects.toThrow(NotFoundError);
  } finally {
    resume.resolve();
    await sql`delete from schedule_changes where id in (${changeId}, ${insertedChangeId})`;
    await sql`delete from login_attempts where key = ${`grades:teacher:${replacement.actor.teacherId}`}`;
    await replacement.close();
  }
});
