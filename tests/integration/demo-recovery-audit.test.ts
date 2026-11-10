import type { Sql } from "postgres";
import { expect, it, vi } from "vitest";
import type { Actor } from "@/application/ports/actor";
import { ChangeRequestStatus } from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import { createDatabase } from "@/infrastructure/db/client";
import { DrizzleStaffUnitOfWork } from "@/infrastructure/db/repositories/requests/staff-unit-of-work";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { refreshDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";
import { eventPayload } from "../fakes/requests-event";
import { openStaffFixture } from "./staff-fixtures";
import { openStudentTestData } from "./student-e2e-data";

async function restoreCurrentDemo(sql: Sql) {
  const clock = new FakeClock(new Date());
  await refreshDemo(sql, clock, { force: true });
}

it("одобрение освобождения поверх засеянного пропуска сохраняется до часа, затем возвращается к фикстуре", async () => {
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const clock = new FakeClock("2035-11-06T09:00:00Z");
  let requestId: string | undefined;
  try {
    await refreshDemo(sql, clock, { force: true });
    const [student] = await sql<
      { id: string; user_id: string; faculty_id: string }[]
    >`select id, user_id, faculty_id from students where seed_key = 'demo:student:timur'`;
    const [staff] = await sql<{ id: string; user_id: string }[]>`
      select id, user_id from staff where seed_key = 'demo:staff:marina'`;
    const [baseline] = await sql`
      select * from attendance_records where seed_key = 'demo:attendance:timur:1:1'`;
    if (!student || !staff || !baseline)
      throw new Error("Нужны демо-студент, сотрудник и засеянный пропуск.");
    const [date] = await sql<{ day: string }[]>`
      select occurrence_date::text as day from attendance_records where id = ${baseline.id}`;
    if (!date) throw new Error("Нужна дата засеянного пропуска.");
    expect(baseline.status).toBe("absent");
    const facultyIds = await sql<{ faculty_id: string }[]>`
      select faculty_id from staff_faculties where staff_id = ${staff.id}`;
    const actor: Actor = {
      kind: "student",
      userId: student.user_id,
      studentId: student.id,
      facultyId: student.faculty_id,
    };
    const employee: Actor = {
      kind: "staff",
      userId: staff.user_id,
      staffId: staff.id,
      facultyIds: facultyIds.map((row) => row.faculty_id),
    };
    const uow = new DrizzleRequestsUnitOfWork(() => sql, ids);
    const change = new ChangeRequestStatus(uow, clock, ids);
    const staffChange = new ChangeStaffRequestStatus(
      new DrizzleStaffUnitOfWork(() => sql, ids),
      clock,
      ids,
      { info() {}, warn() {}, error() {} },
    );
    const reason = `Мероприятие посетителя ${ids.next()}`;
    const draft = await new CreateRequestDraft(uow, clock, ids).execute(actor, {
      typeCode: "event_release",
      payload: {
        ...eventPayload,
        eventName: reason,
        dateFrom: date.day,
        dateTo: date.day,
      },
    });
    requestId = draft.id;
    await change.execute(actor, { id: draft.id, to: "submitted" });
    for (const to of ["accepted", "in_progress", "ready"] as const)
      await staffChange.execute(employee, { id: draft.id, to });
    const [changed] =
      await sql`select * from attendance_records where id = ${baseline.id}`;
    expect(changed).toMatchObject({
      seed_key: baseline.seed_key,
      status: "excused",
      source: "excuse",
      source_key: `event:${draft.id}`,
      reason,
    });
    await refreshDemo(sql, clock);
    expect(
      (
        await sql`select * from attendance_records where id = ${baseline.id}`
      )[0],
    ).toEqual(changed);
    clock.advance(60 * 60 * 1000);
    await refreshDemo(sql, clock);
    expect(
      (
        await sql`select * from attendance_records where id = ${baseline.id}`
      )[0],
    ).toEqual(changed);
    clock.advance(60 * 1000);
    await refreshDemo(sql, clock);
    expect(
      (
        await sql`select * from attendance_records where id = ${baseline.id}`
      )[0],
    ).toEqual(baseline);
    expect(
      await sql`select id from attendance_records where reason = ${reason}`,
    ).toHaveLength(0);
    await refreshDemo(sql, clock);
    expect(
      (
        await sql`select * from attendance_records where id = ${baseline.id}`
      )[0],
    ).toEqual(baseline);
  } finally {
    try {
      if (requestId) {
        await sql`delete from staff_audit_log where request_id = ${requestId}`;
        await sql`delete from notifications where link = ${`/requests/${requestId}`}`;
        await sql`delete from requests where id = ${requestId}`;
      }
      await restoreCurrentDemo(sql);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
});

it("ночной режим без условия часа возвращает свежий сценарий и очищает демо-записи, сохраняя обычного пользователя", async () => {
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const clock = new FakeClock("2035-11-06T09:00:00Z");
  let demo: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
  let ordinary: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
  try {
    await refreshDemo(sql, clock, { force: true });
    demo = await openStudentTestData("anna");
    ordinary = await openStudentTestData("anna");
    await sql`update users set seed_key = ${`night-demo:${demo.actor.userId}`} where id = ${demo.actor.userId}`;
    const [baseline] =
      await sql`select * from requests where seed_key = 'demo:request:8'`;
    if (!baseline) throw new Error("Нужна бумажная демо-заявка.");
    const future = "2035-11-06T09:10:00.000Z";
    await sql`update requests set status = 'issued', payload = '{"destination":"Ночной посетитель"}'::jsonb,
      updated_at = ${future}::timestamptz where id = ${baseline.id}`;
    const visitorId = ids.next();
    await sql`insert into requests (id, student_id, public_no, type_code, payload, status, created_at, updated_at)
      values (${visitorId}, ${demo.actor.studentId}, ${`ТЕСТ-${visitorId}`}, 'enrollment', '{}', 'draft', ${future}::timestamptz, ${future}::timestamptz)`;
    const slot = await sql<
      { id: string }[]
    >`select id from schedule_slots where seed_key = 'demo:slot:fmo:1:0'`;
    if (!slot[0]) throw new Error("Нужна пара демо-группы.");
    for (const account of [demo, ordinary]) {
      await sql`insert into notifications (id,user_id,kind,title,body,link,created_at)
        values (${ids.next()},${account.actor.userId},'request','Свежий текст','Текст посетителя','/requests',${future}::timestamptz)`;
      await sql`insert into assistant_log (id,user_id,question,sources,tool_calls,outcome,at)
        values (${ids.next()},${account.actor.userId},'Свежий вопрос','[]','[]','answered',${future}::timestamptz)`;
      await sql`insert into attendance_records (id,student_id,slot_id,occurrence_date,status,source,source_key,marked_at)
        values (${ids.next()},${account.actor.studentId},${slot[0].id},'2035-11-06','absent','qr',${ids.next()},${future}::timestamptz)`;
      await sql`insert into activity_points (id,student_id,source_key,points,created_at)
        values (${ids.next()},${account.actor.studentId},${ids.next()},1,${future}::timestamptz)`;
    }
    const ordinaryRequests = [
      ...(await sql`select * from requests where student_id = ${ordinary.actor.studentId} order by id`),
    ];
    const ordinaryNotifications = [
      ...(await sql`select * from notifications where user_id = ${ordinary.actor.userId} order by id`),
    ];
    await refreshDemo(sql, clock, { force: false });
    expect(
      await sql`select id from requests where id = ${visitorId}`,
    ).toHaveLength(1);
    expect(
      (await sql`select status from requests where id = ${baseline.id}`)[0]
        ?.status,
    ).toBe("issued");
    vi.stubEnv("DEMO_REFRESH_FORCE", "1");
    await refreshDemo(sql, clock);
    expect(
      (await sql`select * from requests where id = ${baseline.id}`)[0],
    ).toEqual(baseline);
    expect(
      await sql`select id from requests where id = ${visitorId}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from notifications where user_id = ${demo.actor.userId}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from assistant_log where user_id = ${demo.actor.userId}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from attendance_records where student_id = ${demo.actor.studentId}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from activity_points where student_id = ${demo.actor.studentId}`,
    ).toHaveLength(0);
    expect([
      ...(await sql`select * from requests where student_id = ${ordinary.actor.studentId} order by id`),
    ]).toEqual(ordinaryRequests);
    expect([
      ...(await sql`select * from notifications where user_id = ${ordinary.actor.userId} order by id`),
    ]).toEqual(ordinaryNotifications);
    for (const table of [
      "assistant_log",
      "attendance_records",
      "activity_points",
    ])
      expect(
        await sql`select id from ${sql(table)} where ${sql(table === "assistant_log" ? "user_id" : "student_id")} = ${table === "assistant_log" ? ordinary.actor.userId : ordinary.actor.studentId}`,
      ).toHaveLength(1);
  } finally {
    vi.unstubAllEnvs();
    try {
      await demo?.close();
      if (ordinary) {
        await sql`delete from attendance_records where student_id = ${ordinary.actor.studentId}`;
        await sql`delete from activity_points where student_id = ${ordinary.actor.studentId}`;
        await ordinary.close();
      }
      await restoreCurrentDemo(sql);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
});

it("восстановление удаляет только демо-аудит и сохраняет request graph с аудитом обычного сотрудника", async () => {
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const clock = new FakeClock("2035-11-06T09:00:00Z");
  let f: Awaited<ReturnType<typeof openStaffFixture>> | undefined;
  const auditIds = [ids.next(), ids.next()] as const;
  try {
    await refreshDemo(sql, clock, { force: true });
    f = await openStaffFixture();
    f.clock.set(clock.now());
    await sql`update users set seed_key = ${`audit-demo:${f.anna.userId}`} where id = ${f.anna.userId}`;
    const [baseline] =
      await sql`select * from requests where seed_key = 'demo:request:8'`;
    const [demoStaff] =
      await sql`select id from users where seed_key = 'demo:user:marina'`;
    if (!baseline || !demoStaff)
      throw new Error("Нужны демо-заявка и сотрудник.");
    await sql`update requests set status = 'issued', updated_at = ${clock.now().toISOString()}::timestamptz where id = ${baseline.id}`;
    for (const [auditId, userId] of [
      [auditIds[0], f.marina.userId],
      [auditIds[1], demoStaff.id],
    ] as const)
      await sql`insert into staff_audit_log (id,staff_user_id,request_id,action,at)
        values (${auditId},${userId},${baseline.id},'request_issued',${clock.now().toISOString()}::timestamptz)`;
    const visitorId = await f.request(f.anna);
    await f.change.execute(f.marina, { id: visitorId, to: "accepted" });
    const visitorBefore = [
      ...(await sql`select * from requests where id = ${visitorId}`),
    ];
    const auditBefore = [
      ...(await sql`select * from staff_audit_log where staff_user_id = ${f.marina.userId} order by id`),
    ];
    clock.advance(61 * 60 * 1000);
    await refreshDemo(sql, clock);
    expect(
      (await sql`select * from requests where id = ${baseline.id}`)[0],
    ).toEqual(baseline);
    expect(
      await sql`select id from staff_audit_log where id = ${auditIds[1]}`,
    ).toHaveLength(0);
    expect([
      ...(await sql`select * from staff_audit_log where staff_user_id = ${f.marina.userId} order by id`),
    ]).toEqual(auditBefore);
    expect([
      ...(await sql`select * from requests where id = ${visitorId}`),
    ]).toEqual(visitorBefore);
    expect(
      await sql`select id from request_events where request_id = ${visitorId}`,
    ).toHaveLength(2);
  } finally {
    try {
      for (const id of auditIds)
        await sql`delete from staff_audit_log where id = ${id}`;
      await f?.close();
      await restoreCurrentDemo(sql);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
});
