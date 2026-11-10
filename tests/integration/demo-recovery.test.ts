import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { refreshDemo, seedDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

async function requestSnapshot(sql: Sql, requestIds: string[]) {
  return {
    requests: [
      ...(await sql`select * from requests where id in ${sql(requestIds)} order by id`),
    ],
    events: [
      ...(await sql`select * from request_events where request_id in ${sql(requestIds)} order by id`),
    ],
    certificates: [
      ...(await sql`select * from certificates where request_id in ${sql(requestIds)} order by id`),
    ],
    bookings: [
      ...(await sql`select * from pickup_bookings where request_id in ${sql(requestIds)} order by id`),
    ],
    audit: [
      ...(await sql`select * from staff_audit_log where request_id in ${sql(requestIds)} order by id`),
    ],
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Почасовое восстановление демо-сценариев D-50",
  () => {
    it("сохраняет показ до часа после изменения и атомарно возвращает заявки, историю, справки и очередь к сиду", async () => {
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const clock = new FakeClock("2035-11-06T09:00:00Z");
      const previous = new Date();
      try {
        await seedDemo(sql, clock);
        await refreshDemo(sql, clock);
        const seeded = await sql<
          { id: string; student_id: string; seed_key: string }[]
        >`select id, student_id, seed_key from requests where seed_key in ('demo:request:0', 'demo:request:8')`;
        const paper = seeded.find((row) => row.seed_key === "demo:request:8");
        const electronic = seeded.find(
          (row) => row.seed_key === "demo:request:0",
        );
        const [staff] = await sql<{ user_id: string }[]>`
          select user_id from staff where seed_key = 'demo:staff:marina'`;
        const [owner] = await sql<{ user_id: string; faculty_id: string }[]>`
          select user_id, faculty_id from students where id = ${paper?.student_id ?? ids.next()}`;
        if (!paper || !electronic || !staff || !owner)
          throw new Error("Нужны засеянные заявки и сотрудник.");
        const requestIds = [paper.id, electronic.id];
        const baseline = await requestSnapshot(sql, requestIds);
        const changedAt = "2035-11-06T08:50:00.000Z";
        const older = "2035-11-06T07:00:00.000Z";
        await sql`update requests set status = 'issued', assignee_staff_id = null,
          payload = '{"destination":"Изменённое место требования"}'::jsonb,
          updated_at = ${changedAt}::timestamptz where id = ${paper.id}`;
        await sql`update requests set status = 'rejected', updated_at = ${older}::timestamptz
          where id = ${electronic.id}`;
        await sql`update request_events set comment = 'Изменённый текст засеянного события'
          where request_id = ${paper.id} and to_status = 'ready'`;
        await sql`insert into request_events (id, request_id, from_status, to_status, actor_user_id, comment, at)
          values (${ids.next()}, ${paper.id}, 'ready', 'issued', ${staff.user_id},
            'Комментарий посетителя', ${changedAt}::timestamptz)`;
        // A recent event protects a request whose own timestamp is already old.
        await sql`insert into request_events (id, request_id, from_status, to_status, actor_user_id, at)
          values (${ids.next()}, ${electronic.id}, 'ready', 'rejected', ${staff.user_id}, ${changedAt}::timestamptz)`;
        await sql`update certificates set revoked_at = ${changedAt}::timestamptz
          where request_id = ${electronic.id}`;
        const certificateId = ids.next();
        await sql`insert into certificates (id, request_id, number, verify_code, issued_at)
          values (${certificateId}, ${paper.id}, ${`ТЕСТ-${certificateId}`}, ${certificateId}, ${changedAt}::timestamptz)`;
        await sql`insert into pickup_bookings
          (id, user_id, request_id, window_id, slot_starts_at, ticket_no, status, created_at)
          select ${ids.next()}, ${owner.user_id}, ${paper.id}, id,
            '2035-11-07T07:00:00Z'::timestamptz, 'Б-999', 'served', ${changedAt}::timestamptz
          from pickup_windows where faculty_id = ${owner.faculty_id} limit 1`;
        await sql`insert into staff_audit_log (id, staff_user_id, action, request_id, at)
          values (${ids.next()}, ${staff.user_id}, 'request_issued', ${paper.id}, ${changedAt}::timestamptz)`;
        const modified = await requestSnapshot(sql, requestIds);
        await refreshDemo(sql, clock);
        expect(await requestSnapshot(sql, requestIds)).toEqual(modified);
        clock.set("2035-11-06T09:50:00Z");
        await refreshDemo(sql, clock);
        expect(await requestSnapshot(sql, requestIds)).toEqual(modified);
        clock.advance(60_000);
        await refreshDemo(sql, clock);
        expect(await requestSnapshot(sql, requestIds)).toEqual(baseline);
        await refreshDemo(sql, clock);
        expect(await requestSnapshot(sql, requestIds)).toEqual(baseline);
      } finally {
        try {
          clock.set(previous);
          await seedDemo(sql, clock);
          await refreshDemo(sql, clock, { force: true });
        } finally {
          await sql.end({ timeout: 1 });
        }
      }
    }, 30_000);

    it("удаляет только старые записи посетителей демо-аккаунта или засеянного студента, сохраняя свежие, seeded и обычные данные", async () => {
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const account = await openStudentTestData("anna");
      const profile = await openStudentTestData("anna");
      const ordinary = await openStudentTestData("anna");
      const clock = new FakeClock("2035-11-06T09:00:00Z");
      const previous = new Date();
      const old = "2035-11-06T07:59:00.000Z";
      const fresh = "2035-11-06T08:50:00.000Z";
      const boundary = "2035-11-06T08:00:00.000Z";
      const created: {
        owner: "account" | "profile" | "ordinary";
        age: "old" | "fresh" | "boundary" | "seeded";
        requestId: string;
        notificationId: string;
        journalId: string;
        attendanceId: string;
        activityId: string;
      }[] = [];
      try {
        await sql`update users set seed_key = ${`demo-recovery:user:${account.actor.userId}`} where id = ${account.actor.userId}`;
        await sql`update students set seed_key = ${`demo-recovery:student:${profile.actor.studentId}`} where id = ${profile.actor.studentId}`;
        const [slot] = await sql<{ id: string }[]>`
          select id from schedule_slots where seed_key = 'demo:slot:fmo:1:0'`;
        const [staff] = await sql<{ id: string }[]>`
          select id from users where seed_key = 'demo:user:marina' and role = 'staff'`;
        if (!slot || !staff) throw new Error("Нужны пара и демо-сотрудник.");
        for (const [owner, student] of [
          ["account", account],
          ["profile", profile],
          ["ordinary", ordinary],
        ] as const) {
          for (const [age, at, day] of [
            ["old", old, "2035-11-05"],
            ["fresh", fresh, "2035-11-06"],
            ["boundary", boundary, "2035-11-07"],
            ["seeded", old, "2035-11-08"],
          ] as const) {
            const requestId = ids.next();
            const notificationId = ids.next();
            const journalId = ids.next();
            const attendanceId = ids.next();
            const activityId = ids.next();
            const seedKey =
              age === "seeded" ? `demo-recovery:${requestId}` : null;
            created.push({
              owner,
              age,
              requestId,
              notificationId,
              journalId,
              attendanceId,
              activityId,
            });
            await sql`insert into requests (id, seed_key, public_no, student_id, type_code, payload, status, created_at, updated_at)
              values (${requestId}, ${seedKey}, ${`ТЕСТ-${requestId}`}, ${student.actor.studentId},
                'enrollment_paper', '{}'::jsonb, 'ready', ${old}::timestamptz, ${old}::timestamptz)`;
            await sql`insert into request_events (id, request_id, from_status, to_status, actor_user_id, at)
              values (${ids.next()}, ${requestId}, 'in_progress', 'ready', ${student.actor.userId}, ${at}::timestamptz)`;
            await sql`insert into certificates (id, request_id, number, verify_code, issued_at)
              values (${ids.next()}, ${requestId}, ${`ТЕСТ-${requestId}`}, ${requestId}, ${old}::timestamptz)`;
            await sql`insert into pickup_bookings
              (id, user_id, request_id, window_id, slot_starts_at, ticket_no, status, created_at)
              select ${ids.next()}, ${student.actor.userId}, ${requestId}, id,
                '2035-11-07T08:00:00Z'::timestamptz, 'Б-998', 'cancelled', ${old}::timestamptz
              from pickup_windows where faculty_id = ${student.actor.facultyId} limit 1`;
            await sql`insert into staff_audit_log (id, staff_user_id, action, request_id, at)
              values (${ids.next()}, ${staff.id}, 'request_ready', ${requestId}, ${old}::timestamptz)`;
            await sql`insert into notifications (id, seed_key, user_id, kind, title, body, link, created_at)
              values (${notificationId}, ${seedKey}, ${student.actor.userId}, 'request',
                'Тестовое уведомление', 'Текст посетителя', ${`/requests/${requestId}`}, ${at}::timestamptz)`;
            await sql`insert into assistant_log (id, user_id, question, tool_calls, sources, outcome, at)
              values (${journalId}, ${student.actor.userId}, 'Тестовый вопрос посетителя',
                '[]'::jsonb, '[]'::jsonb, 'answered', ${at}::timestamptz)`;
            await sql`insert into attendance_records
              (id, seed_key, student_id, slot_id, occurrence_date, status, source, source_key, marked_at)
              values (${attendanceId}, ${seedKey}, ${student.actor.studentId}, ${slot.id}, ${day},
                'absent', ${age === "old" ? "qr" : "demo"}, ${`closed:${slot.id}:${day}`}, ${at}::timestamptz)`;
            await sql`insert into activity_points (id, seed_key, student_id, source_key, points, created_at)
              values (${activityId}, ${seedKey}, ${student.actor.studentId}, ${requestId}, 2, ${at}::timestamptz)`;
          }
        }
        const requestIds = created.map((row) => row.requestId);
        const before = await requestSnapshot(sql, requestIds);
        await refreshDemo(sql, clock);
        for (const row of created) {
          const removed = row.owner !== "ordinary" && row.age === "old";
          const accountRemoved = row.owner === "account" && row.age === "old";
          for (const table of [
            "requests",
            "request_events",
            "certificates",
            "pickup_bookings",
            "staff_audit_log",
          ])
            expect(
              await sql`select id from ${sql(table)} where ${sql(table === "requests" ? "id" : "request_id")} = ${row.requestId}`,
            ).toHaveLength(removed ? 0 : 1);
          expect(
            await sql`select id from notifications where id = ${row.notificationId}`,
          ).toHaveLength(accountRemoved ? 0 : 1);
          expect(
            await sql`select id from assistant_log where id = ${row.journalId}`,
          ).toHaveLength(
            row.owner === "account" &&
              (row.age === "old" || row.age === "seeded")
              ? 0
              : 1,
          );
          expect(
            await sql`select id from attendance_records where id = ${row.attendanceId}`,
          ).toHaveLength(removed ? 0 : 1);
          expect(
            await sql`select id from activity_points where id = ${row.activityId}`,
          ).toHaveLength(removed ? 0 : 1);
        }
        const after = await requestSnapshot(sql, requestIds);
        const ordinaryIds = created
          .filter((row) => row.owner === "ordinary")
          .map((row) => row.requestId);
        expect(await requestSnapshot(sql, ordinaryIds)).toEqual({
          requests: before.requests.filter((row) =>
            ordinaryIds.includes(row.id),
          ),
          events: before.events.filter((row) =>
            ordinaryIds.includes(row.request_id),
          ),
          certificates: before.certificates.filter((row) =>
            ordinaryIds.includes(row.request_id),
          ),
          bookings: before.bookings.filter((row) =>
            ordinaryIds.includes(row.request_id),
          ),
          audit: before.audit.filter((row) =>
            ordinaryIds.includes(row.request_id),
          ),
        });
        await refreshDemo(sql, clock);
        expect(await requestSnapshot(sql, requestIds)).toEqual(after);
      } finally {
        try {
          await account.close();
          await profile.close();
          await ordinary.close();
          clock.set(previous);
          await seedDemo(sql, clock);
          await refreshDemo(sql, clock, { force: true });
        } finally {
          await sql.end({ timeout: 1 });
        }
      }
    }, 30_000);
  },
);
