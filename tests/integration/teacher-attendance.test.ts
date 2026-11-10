import type { Sql } from "postgres";
import { afterAll, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/application/shared/errors";
import { moscowDate } from "@/domain/schedule/dates";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresAttendanceRecords } from "@/infrastructure/db/repositories/attendance/repository";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { PostgresTeacherScheduleRepository } from "@/infrastructure/db/repositories/teacher/repository";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { cleanupIdentity } from "../../scripts/cleanup-identity";
import { openTeacherTestData } from "./teacher-e2e-data";

const sql = createDatabase(4);
const ids = new UuidV7Generator();
afterAll(() => sql.end({ timeout: 1 }));

async function rollback(action: (db: Sql) => Promise<void>) {
  const marker = new Error("Откат тестовых данных");
  await expect(
    sql.begin(async (tx) => {
      await action(tx as unknown as Sql);
      throw marker;
    }),
  ).rejects.toBe(marker);
}

it("временный преподаватель имеет свою группу и пару и удаляется вместе с ними", async () => {
  const fixture = await openTeacherTestData();
  try {
    expect(
      await new PostgresIdentityRepository(() => fixture.sql).findActorByUserId(
        fixture.actor.userId,
      ),
    ).toEqual(fixture.actor);
    const today = moscowDate(new Date());
    const lessons = await new PostgresTeacherScheduleRepository(
      () => fixture.sql,
    ).listForTeacher(fixture.actor.teacherId, today, today);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.id).toBe(`${fixture.slotId}:${today}`);
  } finally {
    await fixture.close();
  }
  expect(
    await sql`select id from users where id = ${fixture.actor.userId}`,
  ).toHaveLength(0);
  expect(
    await sql`select id from teachers where id = ${fixture.actor.teacherId}`,
  ).toHaveLength(0);
  expect(
    await sql`select id from schedule_slots where id = ${fixture.slotId}`,
  ).toHaveLength(0);
  expect(
    await sql`select id from groups where id = ${fixture.groupId}`,
  ).toHaveLength(0);
});

it("teacher Actor связан с teacher:3; замены по id, переносы через границу недели, отмены и чужие пары", async () => {
  await rollback(async (db) => {
    const users = new PostgresIdentityRepository(() => db);
    const user = await users.findCredentials("oleg");
    const actor = user && (await users.findActorByUserId(user.userId));
    if (actor?.kind !== "teacher") throw new Error("Нужен демо-сид.");
    const [slot] = await db<
      { id: string; teacher_id: string }[]
    >`select id, teacher_id from schedule_slots where seed_key = 'demo:slot:fmo:4:0'`;
    if (!slot) throw new Error("Нет пары.");
    expect(actor.teacherId).toBe(slot.teacher_id);
    await db`update schedule_slots set week_parity = 'odd' where id = ${slot.id}`;
    const other = ids.next();
    await db`insert into teachers (id, full_name) values (${other}, 'Олег Яснев')`;
    await db`delete from schedule_changes where slot_id = ${slot.id} and date = '2026-11-05'`;
    await db`insert into schedule_changes (id, slot_id, date, kind, new_date, new_starts_at, new_ends_at, reason)
      values (${ids.next()}, ${slot.id}, '2026-11-05', 'moved', '2026-11-12', '13:00', '14:30', 'Тест переноса')`;
    const repository = new PostgresTeacherScheduleRepository(() => db);
    const key = { slotId: slot.id, occurrenceDate: "2026-11-05" };
    const moved = await repository.findLessonForTeacher(key, actor.teacherId);
    expect(moved).toMatchObject({
      id: `${slot.id}:2026-11-05`,
      date: "2026-11-12",
      startsAt: "2026-11-12T10:00:00.000Z",
      status: "moved-to",
    });
    expect(
      (
        await repository.listForTeacher(
          actor.teacherId,
          "2026-11-09",
          "2026-11-15",
        )
      ).some((lesson) => lesson.id === moved?.id),
    ).toBe(true);
    expect(
      await repository.listForTeacher(other, "2026-11-02", "2026-11-15"),
    ).toEqual([]);
    await db`insert into schedule_changes (id, slot_id, date, kind, new_teacher_id, reason, created_at)
      values (${ids.next()}, ${slot.id}, '2026-11-05', 'replaced', ${other}, 'Тест замены', now() + interval '1 second')`;
    expect(
      await repository.findLessonForTeacher(key, actor.teacherId),
    ).toBeNull();
    expect(await repository.findLessonForTeacher(key, other)).toMatchObject({
      id: moved?.id,
    });
    expect(
      (
        await repository.listForTeacher(
          actor.teacherId,
          "2026-11-02",
          "2026-11-15",
        )
      ).some((lesson) => lesson.id === moved?.id),
    ).toBe(false);
    await db`insert into schedule_changes (id, slot_id, date, kind, reason, created_at)
      values (${ids.next()}, ${slot.id}, '2026-11-05', 'cancelled', 'Тест отмены', now() + interval '2 seconds')`;
    expect(await repository.findLessonForTeacher(key, other)).toMatchObject({
      status: "cancelled",
    });
    expect(
      await repository.findLessonForTeacher(
        { ...key, occurrenceDate: "2026-11-19" },
        other,
      ),
    ).toBeNull();
    expect(
      await repository.findLessonForTeacher(
        { ...key, occurrenceDate: "2026-11-19" },
        actor.teacherId,
      ),
    ).toMatchObject({ id: `${slot.id}:2026-11-19` });
    const replaced = await repository.listForTeacher(
      other,
      "2026-10-01",
      "2026-12-31",
    );
    expect([...new Set(replaced.map((lesson) => lesson.id))]).toEqual([
      `${slot.id}:2026-11-05`,
    ]);
    expect(replaced.map((lesson) => [lesson.id, lesson.date])).toEqual([
      [`${slot.id}:2026-11-05`, "2026-11-05"],
      [`${slot.id}:2026-11-05`, "2026-11-12"],
    ]);
    const orphan = ids.next();
    await db`insert into users (id, login, password_hash, role) select ${orphan}, ${`teacher-orphan-${orphan}`}, password_hash, 'teacher' from users where login = 'oleg'`;
    expect(await users.findActorByUserId(orphan)).toBeNull();
  });
});

it("AttendanceRecords: свои данные, минимальный список преподавателя, повтор отметки/уважительной причины и баллов", async () => {
  await rollback(async (db) => {
    const studentId = ids.next();
    await db`insert into students (id, full_name, faculty_id, program_id, course, group_id, record_book_no)
      select ${studentId}, 'Учебный студент', faculty_id, program_id, course, group_id, ${`TEST-${studentId}`} from students where seed_key = 'demo:student:anna'`;
    const [slot] = await db<
      { id: string; teacher_id: string }[]
    >`select id, teacher_id from schedule_slots where seed_key = 'demo:slot:fmo:4:0'`;
    if (!slot) throw new Error("Нет пары.");
    const repository = new PostgresAttendanceRecords(() => db, ids);
    const key = { slotId: slot.id, occurrenceDate: "2026-10-29" };
    const input = {
      sourceKey: `qr:${slot.id}:2026-10-29`,
      markedAt: "2026-10-29T06:00:00Z",
    };
    const first = await repository.markPresentForStudent(studentId, key, input);
    expect(
      await repository.markPresentForStudent(studentId, key, {
        ...input,
        markedAt: "2026-10-29T06:01:00Z",
      }),
    ).toEqual(first);
    expect(
      await repository.markExcusedForStudent(studentId, key, {
        ...input,
        reason: "Учебный конкурс",
      }),
    ).toEqual(first);
    const excusedKey = { ...key, occurrenceDate: "2026-10-22" };
    const excuse = {
      sourceKey: "request:test",
      reason: "Учебная олимпиада",
      markedAt: "2026-10-22T06:00:00Z",
    };
    const excused = await repository.markExcusedForStudent(
      studentId,
      excusedKey,
      { ...excuse, markedAt: "2026-10-22T06:30:00Z" },
    );
    expect(
      await repository.markExcusedForStudent(studentId, excusedKey, excuse),
    ).toEqual(excused);
    await repository.awardActivityForStudent(studentId, {
      sourceKey: input.sourceKey,
      points: 1,
      createdAt: input.markedAt,
    });
    await repository.awardActivityForStudent(studentId, {
      sourceKey: input.sourceKey,
      points: 1,
      createdAt: input.markedAt,
    });
    expect(
      await repository.listForStudent(studentId, "2026-10-01", "2026-10-31"),
    ).toEqual({ records: [excused, first], activityPoints: 1 });
    expect(
      await repository.listForStudent(ids.next(), "2026-10-01", "2026-10-31"),
    ).toEqual({ records: [], activityPoints: 0 });
    const visible = await repository.listForTeacherLesson(key, slot.teacher_id);
    expect(visible).toContainEqual({
      fullName: "Учебный студент",
      group: expect.any(String),
      status: "present",
    });
    for (const row of visible)
      expect(Object.keys(row).sort()).toEqual(["fullName", "group", "status"]);
    await expect(
      repository.listForTeacherLesson(key, ids.next()),
    ).rejects.toThrow(NotFoundError);
    const [timur] = await db<
      { id: string }[]
    >`select id from students where seed_key = 'demo:student:timur'`;
    await expect(
      repository.markPresentForStudent(timur?.id ?? ids.next(), key, input),
    ).rejects.toThrow(NotFoundError);
    await expect(
      repository.markExcusedForStudent(studentId, excusedKey, {
        ...excuse,
        reason: " ",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      repository.awardActivityForStudent(studentId, {
        sourceKey: "invalid",
        points: 0.5,
        createdAt: input.markedAt,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

it("БД запрещает открытый код, повтор источника баллов и отметку без причины; коды имеют только hash и expiry", async () => {
  const columns = await sql<
    { column_name: string }[]
  >`select column_name from information_schema.columns where table_name = 'attendance_codes' order by ordinal_position`;
  expect(columns.map((row) => row.column_name)).toEqual([
    "id",
    "slot_id",
    "occurrence_date",
    "teacher_id",
    "code_hash",
    "created_at",
    "expires_at",
  ]);
  const [slot] = await sql<
    { id: string; teacher_id: string }[]
  >`select id, teacher_id from schedule_slots limit 1`;
  if (!slot) throw new Error("Нет пары.");
  await expect(sql`insert into attendance_codes (id, slot_id, occurrence_date, teacher_id, code_hash, created_at, expires_at)
    values (${ids.next()}, ${slot.id}, '2026-11-05', ${slot.teacher_id}, 'not-a-hash', now(), now() + interval '30 seconds')`).rejects.toMatchObject(
    { code: "23514" },
  );
  const [student] = await sql<
    { id: string }[]
  >`select id from students where seed_key = 'demo:student:anna'`;
  if (!student) throw new Error("Нет студента.");
  await expect(sql`insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key)
    values (${ids.next()}, ${student.id}, ${slot.id}, '2050-01-06', 'excused', 'excuse', 'test:no-reason')`).rejects.toMatchObject(
    { code: "23514" },
  );
  await expect(sql`insert into attendance_codes (id, slot_id, occurrence_date, teacher_id, code_hash, created_at, expires_at)
    values (${ids.next()}, ${slot.id}, '2026-11-05', ${slot.teacher_id}, ${"b".repeat(64)}, now(), now())`).rejects.toMatchObject(
    { code: "23514" },
  );
  await rollback(async (db) => {
    const [student] = await db<
      { id: string }[]
    >`select id from students where seed_key = 'demo:student:anna'`;
    if (!student) throw new Error("Нет студента.");
    const id = ids.next();
    await db`insert into attendance_codes (id, slot_id, occurrence_date, teacher_id, code_hash, created_at, expires_at)
      values (${id}, ${slot.id}, '2026-11-05', ${slot.teacher_id}, ${"a".repeat(64)}, now(), now() + interval '30 seconds')`;
    const [code] = await db<
      { code_hash: string; created_at: Date; expires_at: Date }[]
    >`select code_hash, created_at, expires_at from attendance_codes where id = ${id}`;
    expect(code?.expires_at.getTime()).toBe(
      (code?.created_at.getTime() ?? 0) + 30_000,
    );
    await db`update attendance_codes set expires_at = created_at + interval '2 minutes' where id = ${id}`;
    await db`insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key, reason)
      values (${ids.next()}, ${student.id}, ${slot.id}, '2050-01-06', 'excused', 'excuse', 'test:reason-boundary', ${"🙂".repeat(300)})`;
  });
  await expect(sql`insert into attendance_codes (id, slot_id, occurrence_date, teacher_id, code_hash, created_at, expires_at)
    values (${ids.next()}, ${slot.id}, '2026-11-05', ${slot.teacher_id}, ${"c".repeat(64)}, now(), now() + interval '120.001 seconds')`).rejects.toMatchObject(
    { code: "23514", constraint_name: "attendance_codes_max_lifetime" },
  );
  await expect(sql`insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key, reason)
    values (${ids.next()}, ${student.id}, ${slot.id}, '2050-01-06', 'excused', 'excuse', 'test:long-reason', ${"я".repeat(301)})`).rejects.toMatchObject(
    { code: "23514", constraint_name: "attendance_reason_length" },
  );
});

it("cleanup удаляет коды ровно на границе срока и сохраняет действующий код", async () => {
  const fixture = await openTeacherTestData();
  const now = new Date();
  const codeIds = [ids.next(), ids.next(), ids.next()];
  try {
    for (const [index, id] of codeIds.entries()) {
      const hash = id.replaceAll("-", "").padEnd(64, "0");
      await fixture.sql`insert into attendance_codes (id, slot_id, occurrence_date, teacher_id, code_hash, created_at, expires_at)
        values (${id}, ${fixture.slotId}, ${moscowDate(now)}, ${fixture.actor.teacherId}, ${hash}, ${new Date(now.getTime() - 30_000).toISOString()}, ${new Date(now.getTime() + index - 1).toISOString()})`;
    }
    const [expired] = await fixture.sql<
      { count: number }[]
    >`select count(*)::int as count from attendance_codes where expires_at <= ${now.toISOString()}::timestamptz`;
    expect((await cleanupIdentity(fixture.sql, now)).attendanceCodes).toBe(
      expired?.count,
    );
    const remaining = await fixture.sql<
      { id: string }[]
    >`select id from attendance_codes where teacher_id = ${fixture.actor.teacherId}`;
    expect(remaining).toEqual([{ id: codeIds[2] }]);
  } finally {
    await fixture.close();
  }
});
