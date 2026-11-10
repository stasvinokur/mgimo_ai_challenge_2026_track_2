import { expect, it } from "vitest";
import { INVALID_CODE } from "@/application/attendance/student";
import { ConflictError, NotFoundError } from "@/application/shared/errors";
import { addDays } from "@/domain/schedule/dates";
import { LocalAttendanceQrEncoder } from "@/infrastructure/attendance/qr";
import { CryptoAttendanceTokens } from "@/infrastructure/attendance/tokens";
import { FakeClock } from "../fakes/clock";
import { attendanceServices, openAttendanceTestData } from "./attendance-data";
import { openStudentTestData } from "./student-e2e-data";

const serverInput = (input: unknown) =>
  typeof input === "object" && input !== null
    ? { ...input, ip: "192.0.2.35" }
    : input;

it("криптография: случайные 128 бит base64url, sha256 hex, локальный SVG", async () => {
  const tokens = new CryptoAttendanceTokens();
  const codes = new Set(Array.from({ length: 100 }, () => tokens.generate()));
  expect(codes.size).toBe(100);
  for (const code of codes) {
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(code, "base64url")).toHaveLength(16);
    expect(tokens.hash(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens.hash(code)).toBe(tokens.hash(code));
  }
  const svg = await new LocalAttendanceQrEncoder().encode(
    "https://pulse.example/attend/example",
  );
  expect(decodeURIComponent(svg)).toContain("<svg");
});
it("PostgreSQL: GET не пишет, конкурентные повторы дают одну отметку и балл, полный ростер/уважительная причина, закрытие", async () => {
  const f = await openAttendanceTestData();
  try {
    const clock = new FakeClock(new Date());
    const s = attendanceServices(f, clock);
    await s.records.markExcusedForStudent(f.excused.actor.studentId, f.key, {
      sourceKey: "request:attendance-test",
      reason: "Учебная олимпиада",
      markedAt: clock.now().toISOString(),
    });
    const qr = await s.issue.execute(
      f.teacher.actor,
      serverInput({ lesson: f.key }),
    );
    const code = qr.path.slice(8);
    const hashes = await f.teacher
      .sql`select code_hash from attendance_codes where slot_id = ${f.key.slotId}`;
    expect(hashes).toEqual([{ code_hash: s.tokens.hash(code) }]);
    const before = await f.teacher
      .sql`select * from attendance_records where slot_id = ${f.key.slotId}`;
    await s.preview.execute(f.student.actor, { code });
    expect(
      await f.teacher
        .sql`select * from attendance_records where slot_id = ${f.key.slotId}`,
    ).toEqual(before);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        s.mark.execute(f.student.actor, serverInput({ code })),
      ),
    );
    expect(results.filter((row) => row.result === "marked")).toHaveLength(1);
    expect(results.filter((row) => row.result === "already")).toHaveLength(5);
    expect(await s.summary.execute(f.student.actor)).toMatchObject({
      activityPoints: 1,
      courses: [{ present: 1, total: 1, percent: 100 }],
    });
    const roster = await s.roster.execute(f.teacher.actor, f.key);
    expect(roster).toMatchObject({ present: 1, total: 3 });
    expect(roster.roster).toContainEqual({
      fullName: "Участник конкурса",
      group: expect.any(String),
      status: "excused",
      reason: "Учебная олимпиада",
    });
    expect(roster.roster).toContainEqual({
      fullName: "Студент без отметки",
      group: expect.any(String),
      status: null,
      reason: null,
    });
    for (const row of roster.roster)
      expect(Object.keys(row).sort()).toEqual([
        "fullName",
        "group",
        "reason",
        "status",
      ]);
    await s.close.execute(f.teacher.actor, serverInput(f.key));
    await s.close.execute(f.teacher.actor, serverInput(f.key));
    const attempts = await f.teacher.sql<{ key: string }[]>`
      select key from login_attempts
      where key like ${`attendance:%:${f.teacher.actor.userId}%`}
        or key like ${`attendance:%:${f.student.actor.userId}%`}`;
    for (const [action, actor] of [
      ["issue", f.teacher.actor],
      ["mark", f.student.actor],
      ["close", f.teacher.actor],
    ] as const)
      expect(attempts.map((row) => row.key)).toContain(
        `attendance:${action}:${actor.userId}:${s.tokens.hash("192.0.2.35")}`,
      );
    expect(attempts.every((row) => !row.key.includes("192.0.2.35"))).toBe(true);
    expect(
      await s.mark.execute(f.unmarked.actor, serverInput({ code })),
    ).toEqual({
      result: "invalid",
      messageCode: INVALID_CODE,
    });
    await expect(
      s.issue.execute(
        f.teacher.actor,
        serverInput({ lesson: f.key, previousCode: code }),
      ),
    ).rejects.toThrow(ConflictError);
    expect(await s.summary.execute(f.unmarked.actor)).toMatchObject({
      activityPoints: 0,
      courses: [{ present: 0, total: 1, percent: 0 }],
    });
    expect(await s.summary.execute(f.excused.actor)).toMatchObject({
      activityPoints: 0,
      courses: [{ excused: 1, total: 0, percent: null }],
    });
    expect(
      await f.teacher
        .sql`select status from attendance_records where slot_id = ${f.key.slotId}`,
    ).toHaveLength(3);
    expect(
      await f.teacher
        .sql`select id from attendance_codes where slot_id = ${f.key.slotId}`,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});
it("PostgreSQL: чужая группа, чужой преподаватель, истечение и перенос/отмена после выдачи", async () => {
  const f = await openAttendanceTestData();
  const outsider = await openStudentTestData("timur");
  try {
    const clock = new FakeClock(new Date());
    const s = attendanceServices(f, clock);
    const qr = await s.issue.execute(
      f.teacher.actor,
      serverInput({ lesson: f.key }),
    );
    const input = { code: qr.path.slice(8) };
    const invalid = { result: "invalid", messageCode: INVALID_CODE };
    expect(await s.mark.execute(outsider.actor, serverInput(input))).toEqual(
      invalid,
    );
    await expect(
      s.roster.execute(
        { ...f.teacher.actor, teacherId: f.teacher.ids.next() },
        f.key,
      ),
    ).rejects.toThrow(NotFoundError);
    await expect(
      s.issue.execute(
        { ...f.teacher.actor, teacherId: f.teacher.ids.next() },
        serverInput({ lesson: f.key }),
      ),
    ).rejects.toThrow(NotFoundError);
    clock.advance(30000);
    expect(await s.mark.execute(f.student.actor, serverInput(input))).toEqual(
      invalid,
    );
    clock.advance(-30000);
    await f.teacher
      .sql`insert into schedule_changes (id, slot_id, date, kind, new_date, new_starts_at, new_ends_at, reason) values (${f.teacher.ids.next()}, ${f.key.slotId}, ${f.key.occurrenceDate}, 'moved', ${addDays(f.key.occurrenceDate, 1)}, '23:58:00', '23:59:00', 'Учебный перенос')`;
    expect(await s.preview.execute(f.student.actor, input)).toMatchObject({
      valid: false,
    });
    await f.teacher
      .sql`insert into schedule_changes (id, slot_id, date, kind, reason, created_at) values (${f.teacher.ids.next()}, ${f.key.slotId}, ${f.key.occurrenceDate}, 'cancelled', 'Учебная отмена', now() + interval '1 second')`;
    expect(await s.mark.execute(f.student.actor, serverInput(input))).toEqual(
      invalid,
    );
    expect(
      (
        await s.records.listForStudent(
          f.student.actor.studentId,
          f.key.occurrenceDate,
          f.key.occurrenceDate,
        )
      ).records,
    ).toEqual([]);
  } finally {
    await outsider.close();
    await f.close();
  }
});
it("PostgreSQL: откат present при сбое начисления балла", async () => {
  const f = await openAttendanceTestData();
  try {
    const clock = new FakeClock(new Date());
    const s = attendanceServices(f, clock);
    const qr = await s.issue.execute(
      f.teacher.actor,
      serverInput({ lesson: f.key }),
    );
    const failing = {
      ...s.uow,
      run: <T>(work: Parameters<typeof s.uow.run<T>>[0]) =>
        s.uow.run(async (ctx) => {
          ctx.records.awardActivityForStudent = async () => {
            throw new Error("TEST_POINT_FAILURE");
          };
          return work(ctx);
        }),
    };
    const { MarkAttendance } = await import("@/application/attendance/student");
    const { FakeRateLimiter } = await import("../fakes/identity");
    await expect(
      new MarkAttendance(
        failing,
        s.tokens,
        clock,
        new FakeRateLimiter(clock),
      ).execute(f.student.actor, { code: qr.path.slice(8), ip: "192.0.2.35" }),
    ).rejects.toThrow("TEST_POINT_FAILURE");
    expect(
      (
        await s.records.listForStudent(
          f.student.actor.studentId,
          f.key.occurrenceDate,
          f.key.occurrenceDate,
        )
      ).records,
    ).toEqual([]);
  } finally {
    await f.close();
  }
});

it("PostgreSQL: исторический/будущий occurrence и чужой преподаватель не создают absent", async () => {
  const f = await openAttendanceTestData();
  try {
    const clock = new FakeClock(new Date());
    const s = attendanceServices(f, clock);
    const codesBefore = await f.teacher
      .sql`select id from attendance_codes where slot_id = ${f.key.slotId}`;
    for (const occurrenceDate of [
      addDays(f.key.occurrenceDate, -7),
      addDays(f.key.occurrenceDate, 7),
    ]) {
      const key = { ...f.key, occurrenceDate };
      await expect(
        s.close.execute(f.teacher.actor, serverInput(key)),
      ).rejects.toThrow(ConflictError);
      await expect(
        s.issue.execute(f.teacher.actor, serverInput({ lesson: key })),
      ).rejects.toThrow(ConflictError);
    }
    await expect(
      s.close.execute(
        { ...f.teacher.actor, teacherId: f.teacher.ids.next() },
        serverInput(f.key),
      ),
    ).rejects.toThrow(NotFoundError);
    expect(
      await f.teacher
        .sql`select id from attendance_records where slot_id = ${f.key.slotId}`,
    ).toHaveLength(0);
    expect(
      await f.teacher
        .sql`select id from attendance_codes where slot_id = ${f.key.slotId}`,
    ).toEqual(codesBefore);
    const originalDate = addDays(f.key.occurrenceDate, -7);
    await f.teacher
      .sql`insert into schedule_changes (id, slot_id, date, kind, new_date, new_starts_at, new_ends_at, reason) values (${f.teacher.ids.next()}, ${f.key.slotId}, ${originalDate}, 'moved', ${f.key.occurrenceDate}, '00:00:00', '23:59:59', 'Учебный перенос на фактический день')`;
    await expect(
      s.close.execute(
        f.teacher.actor,
        serverInput({ ...f.key, occurrenceDate: originalDate }),
      ),
    ).resolves.toEqual({ closed: true });
    expect(
      await f.teacher
        .sql`select occurrence_date::text as date from attendance_records where slot_id = ${f.key.slotId}`,
    ).toEqual(Array.from({ length: 3 }, () => ({ date: originalDate })));
  } finally {
    await f.close();
  }
});
