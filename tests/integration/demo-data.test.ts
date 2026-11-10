import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoAccounts } from "../../scripts/fixtures/identity";
import { addWorkDays, moscowDate } from "../../scripts/fixtures/shared";
import { refreshDemo, seedDemo } from "../../scripts/seed";
import { Argon2PasswordHasher } from "../../src/infrastructure/auth/argon2-password-hasher";
import { createDatabase } from "../../src/infrastructure/db/client";
import { assessments } from "../../src/infrastructure/db/schema";
import { UuidV7Generator } from "../../src/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStudentTestData } from "./student-e2e-data";

describe.skipIf(!process.env.DATABASE_URL)("Демо-набор в PostgreSQL", () => {
  let sql: ReturnType<typeof createDatabase>;
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  const ids = new UuidV7Generator();

  beforeAll(async () => {
    sql = createDatabase(1);
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(
        new URL("../../drizzle/", import.meta.url),
      ),
    });
    await seedDemo(sql, clock);
  }, 30_000);
  afterAll(async () => {
    await sql.end({ timeout: 1 });
  });

  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const { name } of await sql<
      { name: string }[]
    >`select table_name as name from information_schema.columns where table_schema = 'public' and column_name = 'seed_key' order by table_name`) {
      result[name] =
        await sql`select * from ${sql(name)} where seed_key like 'demo:%' order by seed_key`;
    }
    result.staffFaculties =
      await sql`select * from staff_faculties order by staff_id, faculty_id`;
    return result;
  }

  it("повторный сид сохраняет записи, UUID, пароли и код справки без дубликатов", async () => {
    const before = await snapshot();
    await seedDemo(sql, clock);
    expect(await snapshot()).toEqual(before);
    const users = await sql<
      { login: string; password_hash: string }[]
    >`select login, password_hash from users where seed_key like 'demo:user:%'`;
    expect(users).toHaveLength(demoAccounts.length);
    const hasher = new Argon2PasswordHasher();
    for (const account of demoAccounts) {
      const hash =
        users.find((user) => user.login === account.login)?.password_hash ?? "";
      expect(hash.startsWith("$argon2id$")).toBe(true);
      expect(await hasher.verify(hash, account.password)).toBe(true);
      expect(await hasher.verify(hash, "wrong-test-password")).toBe(false);
    }
    const [count] = await sql<
      { value: number }[]
    >`select count(*)::int as value from students where seed_key like 'demo:student:%' and user_id is null`;
    expect(count?.value).toBe(12);
  }, 30_000);

  it("refresh и повторный сид сохраняют записи обычного пользователя во всех обновляемых таблицах", async () => {
    const ordinary = await openStudentTestData("anna");
    const [anna] = await sql<
      { id: string; user_id: string; group_id: string; faculty_id: string }[]
    >`select id, user_id, group_id, faculty_id from students where id = ${ordinary.actor.studentId}`;
    if (!anna) throw new Error("Нет демо-студента.");
    const [slot] = await sql<
      { id: string; course_id: string; room_id: string }[]
    >`select id, course_id, room_id from schedule_slots where seed_key = 'demo:slot:fmo:1:0'`;
    if (!slot) throw new Error("Нет демо-занятия.");
    // Raw SQL shares Drizzle's codecs: parameters are serialized explicitly.
    const instant = new Date("2025-01-01T10:00:00Z").toISOString();
    const request = ids.next();
    const assessment = ids.next();
    const records = [
      {
        table: "requests",
        id: request,
        public_no: `З-ТЕСТ-${request}`,
        student_id: anna.id,
        type_code: "question",
        payload: JSON.stringify({
          question: "Пользовательский учебный вопрос",
        }),
        status: "submitted",
        submitted_at: instant,
        due_at: instant,
        created_at: instant,
        updated_at: instant,
      },
      {
        table: "assessments",
        id: assessment,
        course_id: slot.course_id,
        group_id: anna.group_id,
        kind: "control",
        title: "Работа пользователя",
        weight: 10,
        max_score: 100,
        is_required: true,
        due_at: instant,
      },
      {
        table: "scores",
        id: ids.next(),
        assessment_id: assessment,
        student_id: anna.id,
        score: 75,
        graded_at: instant,
      },
      {
        table: "score_events",
        id: ids.next(),
        assessment_id: assessment,
        student_id: anna.id,
        student_user_id: anna.user_id,
        previous_score: 70,
        new_score: 75,
        changed_by_user_id: anna.user_id,
        reason: "Причина пользователя",
        created_at: instant,
      },
      {
        table: "pickup_windows",
        id: ids.next(),
        faculty_id: anna.faculty_id,
        title: "Пользовательское окно",
        opens_at: "10:00:00",
        closes_at: "12:00:00",
      },
      {
        table: "schedule_changes",
        id: ids.next(),
        slot_id: slot.id,
        date: "2025-01-01",
        kind: "cancelled",
        reason: "Изменение пользователя",
        created_at: instant,
      },
      {
        table: "sessions_exams",
        id: ids.next(),
        course_id: slot.course_id,
        group_id: anna.group_id,
        kind: "credit",
        at: instant,
        room_id: slot.room_id,
      },
      {
        table: "request_events",
        id: ids.next(),
        request_id: request,
        from_status: "draft",
        to_status: "submitted",
        actor_user_id: anna.user_id,
        at: instant,
      },
      {
        table: "certificates",
        id: ids.next(),
        request_id: request,
        number: `С-ТЕСТ-${request}`,
        verify_code: request,
        issued_at: instant,
      },
      {
        table: "notifications",
        id: ids.next(),
        user_id: anna.user_id,
        kind: "news",
        priority: "normal",
        title: "Сообщение пользователя",
        body: "Пользовательский текст",
        link: "/notifications",
        created_at: instant,
      },
      {
        table: "announcements",
        id: ids.next(),
        audience: "all",
        title: "Объявление пользователя",
        body: "Пользовательский текст",
        published_at: instant,
      },
      {
        table: "attendance_records",
        id: ids.next(),
        student_id: anna.id,
        slot_id: slot.id,
        occurrence_date: "2025-01-01",
        status: "excused",
        source: "excuse",
        source_key: `request:${request}`,
        reason: "Учебная конференция пользователя",
        marked_at: instant,
      },
      {
        table: "activity_points",
        id: ids.next(),
        student_id: anna.id,
        source_key: `request:${request}`,
        points: 2,
        created_at: instant,
      },
    ];
    const read = async () => {
      const rows = [];
      for (const record of records)
        rows.push(
          await sql`select * from ${sql(record.table)} where id = ${record.id}`,
        );
      return rows;
    };
    try {
      for (const { table, ...record } of records)
        await sql`insert into ${sql(table)} ${sql(record)}`;
      const before = await read();
      expect(
        before.every((rows) => rows.length === 1 && rows[0]?.seed_key === null),
      ).toBe(true);
      expect(before[0]?.[0]?.payload).toEqual({
        question: "Пользовательский учебный вопрос",
      });
      expect(before[0]?.[0]?.submitted_at).toEqual(new Date(instant));
      clock.set("2027-01-03T09:00:00Z");
      await refreshDemo(sql, clock);
      await seedDemo(sql, clock);
      expect(await read()).toEqual(before);
    } finally {
      for (const record of [...records].reverse())
        await sql`delete from ${sql(record.table)} where id = ${record.id}`;
      await ordinary.close();
    }
  }, 30_000);

  it("сид M5 содержит бумажную справку Анны, окна двух факультетов и изменение от её преподавателя", async () => {
    const counts = await readDemoAccountCounts(sql);
    expect(counts.find((row) => row.login === "anna")?.requests).toBe(3);
    expect(counts.find((row) => row.login === "timur")?.requests).toBe(0);
    const paper = await sql`
      select r.status, t.delivery, t.is_certificate, t.fields_schema
      from requests r join request_types t on t.code = r.type_code
      join students s on s.id = r.student_id
      where r.seed_key = 'demo:request:8' and s.seed_key = 'demo:student:anna'`;
    expect(paper).toEqual([
      expect.objectContaining({
        status: "ready",
        delivery: "pickup",
        is_certificate: true,
        fields_schema: expect.objectContaining({ fieldOrder: ["destination"] }),
      }),
    ]);
    const windows = await sql`
      select f.code from pickup_windows w join faculties f on f.id = w.faculty_id
      where w.seed_key like 'demo:pickup-window:%' order by f.code`;
    expect(windows).toEqual([{ code: "FMO" }, { code: "IMP" }]);
    const events = await sql`
      select e.previous_score, e.new_score, e.reason, s.score,
        exists(select 1 from schedule_slots sl
          where sl.teacher_id = t.id and sl.course_id = a.course_id and sl.group_id = a.group_id) as owns_course
      from score_events e join students p on p.id = e.student_id
      join assessments a on a.id = e.assessment_id
      join scores s on s.assessment_id = a.id and s.student_id = p.id
      join teachers t on t.user_id = e.changed_by_user_id
      where e.seed_key = 'demo:score-event:anna:appeal' and p.seed_key = 'demo:student:anna'`;
    expect(events).toEqual([
      {
        previous_score: 85,
        new_score: 90,
        reason: "appeal_review",
        score: 90,
        owns_course: true,
      },
    ]);
  });

  it.each([
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2027-01-03",
  ])(
    "сценарии доступны %s с управляемыми часами",
    async (day) => {
      clock.set(`${day}T09:00:00Z`);
      // Cases select independent calendar dates rather than advancing one clock.
      await seedDemo(sql, clock);
      await refreshDemo(sql, clock);
      const sunday = clock.now().getUTCDay() === 0;
      const studyDate = new Date(
        clock.now().getTime() + (sunday ? 86_400_000 : 0),
      );
      const [change] = await sql<
        {
          date: string;
          weekday: number;
          group_id: string;
          anna_group: string;
        }[]
      >`select c.date::text, s.weekday, s.group_id, a.group_id as anna_group from schedule_changes c join schedule_slots s on s.id = c.slot_id join students a on a.seed_key = 'demo:student:anna' where c.seed_key = 'demo:change:anna'`;
      expect(change?.date).toBe(moscowDate(studyDate));
      expect(change?.weekday).toBe(studyDate.getUTCDay());
      expect(change?.group_id).toBe(change?.anna_group);
      const history = await sql<
        { date: string; weekday: number; status: string }[]
      >`
        select a.occurrence_date::text as date, sl.weekday, a.status from attendance_records a
        join schedule_slots sl on sl.id = a.slot_id where a.seed_key like 'demo:attendance:%'`;
      expect(history).toHaveLength(12);
      expect(new Set(history.map((row) => row.status))).toEqual(
        new Set(["present", "excused", "absent"]),
      );
      for (const row of history) {
        expect(row.date < moscowDate(studyDate)).toBe(true);
        expect(new Date(`${row.date}T12:00:00+03:00`).getUTCDay()).toBe(
          row.weekday,
        );
      }
      const activity = await sql<
        { login: string; points: number }[]
      >`select u.login, sum(a.points)::int as points from activity_points a join students s on s.id = a.student_id join users u on u.id = s.user_id where a.seed_key like 'demo:activity:%' group by u.login order by u.login`;
      expect(activity).toEqual([
        { login: "anna", points: 5 },
        { login: "timur", points: 3 },
      ]);
      const statuses = await sql<
        { login: string; present: number; excused: number; absent: number }[]
      >`
        select u.login, count(*) filter (where a.status = 'present')::int as present,
          count(*) filter (where a.status = 'excused')::int as excused, count(*) filter (where a.status = 'absent')::int as absent
        from attendance_records a join students s on s.id = a.student_id join users u on u.id = s.user_id
        where a.seed_key like 'demo:attendance:%' group by u.login order by u.login`;
      expect(statuses).toEqual([
        { login: "anna", present: 5, excused: 1, absent: 0 },
        { login: "timur", present: 3, excused: 1, absent: 2 },
      ]);
      const [timur] = await sql<
        { count: number }[]
      >`select count(*)::int from requests r join students s on s.id = r.student_id where s.seed_key = 'demo:student:timur' and r.seed_key is not null`;
      expect(timur?.count).toBe(0);
      const [debt] = await sql<
        { is_required: boolean; due: string; score: number | null }[]
      >`select a.is_required, a.due_at::text as due, s.score from assessments a join scores s on s.assessment_id = a.id join students p on p.id = s.student_id where a.seed_key = 'demo:assessment:imp:0:0' and p.seed_key = 'demo:student:timur'`;
      expect(debt?.is_required).toBe(true);
      expect(new Date(debt?.due ?? "").getTime()).toBeLessThan(
        clock.now().getTime(),
      );
      expect(debt?.score).toBeNull();
      const queue = await sql<
        { submitted_at: Date; due_at: Date; sla_work_days: number }[]
      >`select r.submitted_at, r.due_at, t.sla_work_days from requests r join request_types t on t.code = r.type_code join students p on p.id = r.student_id join staff_faculties sf on sf.faculty_id = p.faculty_id join staff s on s.id = sf.staff_id where s.seed_key = 'demo:staff:marina' and r.seed_key like 'demo:request:%'`;
      expect(queue).toHaveLength(9);
      for (const row of queue) {
        expect(row.submitted_at).toBeInstanceOf(Date);
        expect(row.due_at).toBeInstanceOf(Date);
      }
      expect(queue.filter((row) => row.due_at < clock.now())).toHaveLength(2);
      const [summary] = await sql<
        { overdue: number }[]
      >`select count(*)::int as overdue from requests where seed_key like 'demo:request:%' and due_at < ${clock.now().toISOString()}::timestamptz`;
      expect(summary?.overdue).toBe(2);
      for (const row of queue)
        expect(addWorkDays(row.submitted_at, row.sla_work_days)).toEqual(
          row.due_at,
        );
      const [deadline] = await sql<
        { due: Date }[]
      >`select due_at as due from assessments where seed_key = 'demo:assessment:imp:1:2'`;
      expect(moscowDate(deadline?.due ?? new Date(0))).toBe(
        moscowDate(new Date(clock.now().getTime() + 2 * 86_400_000)),
      );
    },
    30_000,
  );

  it("refresh сохраняет свежую изменённую демо-отметку и возвращает фикстуру через час", async () => {
    const [original] = await sql<
      {
        id: string;
        status: string;
        source: string;
        source_key: string;
        reason: string | null;
        marked_at: Date;
      }[]
    >`
      select * from attendance_records where seed_key = 'demo:attendance:anna:2:1'`;
    if (!original) throw new Error("Нет демо-отметки.");
    const previous = clock.now().toISOString();
    try {
      await sql`update attendance_records set status = 'excused', source = 'excuse', source_key = 'request:test-preserve', reason = 'Учебный конкурс', marked_at = ${clock.now().toISOString()}::timestamptz where id = ${original.id}`;
      const [before] =
        await sql`select * from attendance_records where id = ${original.id}`;
      await refreshDemo(sql, clock);
      await seedDemo(sql, clock);
      const [after] =
        await sql`select * from attendance_records where id = ${original.id}`;
      expect(after).toEqual(before);
      clock.advance(61 * 60 * 1000);
      await refreshDemo(sql, clock);
      expect(
        (
          await sql`select * from attendance_records where id = ${original.id}`
        )[0],
      ).toEqual(original);
    } finally {
      await sql`update attendance_records set status = ${original.status}, source = ${original.source}, source_key = ${original.source_key}, reason = ${original.reason}, marked_at = ${original.marked_at.toISOString()} where id = ${original.id}`;
      clock.set(previous);
      await refreshDemo(sql, clock, { force: true });
    }
  }, 30_000);

  it("raw SQL и ORM возвращают Date независимо от инициализации Drizzle и кэша запросов", async () => {
    const client = createDatabase(1);
    try {
      const [before] = await client<
        { at: Date }[]
      >`select '2026-11-04T09:00:00Z'::timestamptz as at`;
      const db = drizzle(client);
      const [after] = await client<
        { at: Date }[]
      >`select '2026-11-04T09:00:00Z'::timestamptz as at, 1 as fresh_query`;
      const [prepared] = await client<
        { at: Date }[]
      >`select '2026-11-04T09:00:00Z'::timestamptz as at`;
      for (const row of [before, after, prepared]) {
        expect(row?.at).toBeInstanceOf(Date);
        expect(row?.at).toEqual(new Date("2026-11-04T09:00:00Z"));
      }
      const [work] = await db
        .select({ dueAt: assessments.dueAt })
        .from(assessments)
        .where(eq(assessments.seedKey, "demo:assessment:imp:1:2"));
      expect(work?.dueAt).toBeInstanceOf(Date);
      const payload = { question: "Тест сериализации", nested: { value: 1 } };
      const [roundtrip] = await client<
        { at: Date; payload: unknown }[]
      >`select ${JSON.stringify(payload)}::jsonb as payload, ${new Date("2026-11-04T09:00:00Z").toISOString()}::timestamptz as at`;
      expect(roundtrip?.payload).toEqual(payload);
      expect(roundtrip?.at).toEqual(before?.at);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it("FTS находит русскую словоформу и обновляет вектор при изменении текста", async () => {
    const id = ids.next();
    try {
      await sql`insert into regulation_chunks (id, doc_slug, section, title, body) values (${id}, ${id}, '1', 'Учебное правило', 'Документы выдаются студентам')`;
      const first =
        await sql`select id from regulation_chunks where id = ${id} and tsv @@ plainto_tsquery('russian', 'документ')`;
      expect(first).toHaveLength(1);
      await sql`update regulation_chunks set body = 'Консультации проводятся по записи' where id = ${id}`;
      const changed =
        await sql`select id from regulation_chunks where id = ${id} and tsv @@ plainto_tsquery('russian', 'документ')`;
      expect(changed).toHaveLength(0);
    } finally {
      await sql`delete from regulation_chunks where id = ${id}`;
    }
  });
});
