import { drizzle } from "drizzle-orm/postgres-js";
import { ChangeRequestStatus } from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { PreviewEventRelease } from "@/application/requests/event-release";
import { GetMyRequest } from "@/application/requests/queries";
import { PostgresAttendanceRecords } from "@/infrastructure/db/repositories/attendance/repository";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import { PostgresScheduleRepository } from "@/infrastructure/db/repositories/schedule/repository";
import * as schema from "@/infrastructure/db/schema";
import { eventPayload, eventType } from "../fakes/requests-event";
import { openStaffFixture } from "./staff-fixtures";

export async function openEventRequestFixture() {
  const f = await openStaffFixture();
  const database = () => f.sql;
  const schedule = new PostgresScheduleRepository(database);
  const attendance = new PostgresAttendanceRecords(database, f.ids);
  const uow = new DrizzleRequestsUnitOfWork(database, f.ids);
  const studentChange = new ChangeRequestStatus(uow, f.clock, f.ids);
  const create = new CreateRequestDraft(uow, f.clock, f.ids);
  const get = new GetMyRequest(
    new DrizzleRequestRepository(() => drizzle(f.sql, { schema })),
    f.clock,
  );
  const payload = {
    ...eventPayload,
    eventName: f.marker,
    dateFrom: "2026-11-09",
    dateTo: "2026-11-10",
  };
  await f.sql`insert into request_types (code, title, description, sla_work_days, delivery, fields_schema, is_certificate)
    values (${eventType.code}, ${eventType.title}, ${eventType.description}, ${eventType.slaWorkDays}, ${eventType.delivery}, ${f.sql.json(eventType.fieldsSchema)}, false)
    on conflict (code) do nothing`;
  return {
    ...f,
    attendance,
    change: f.change,
    studentChange,
    get,
    payload,
    preview: new PreviewEventRelease(schedule, f.clock),
    async createEvent(submit = true, owner = f.anna) {
      const draft = await create.execute(owner, {
        typeCode: "event_release",
        payload: {
          ...payload,
          eventLessons: [{ slotId: "forged", occurrenceDate: "2026-11-09" }],
        },
      });
      if (submit)
        await studentChange.execute(owner, { id: draft.id, to: "submitted" });
      return draft.id;
    },
    async progress(id: string) {
      await f.change.execute(f.limited, { id, to: "accepted" });
      await f.change.execute(f.limited, { id, to: "in_progress" });
    },
    async close() {
      try {
        if (f.anna.kind !== "student") throw new Error("Нужен студент");
        await f.sql`delete from assistant_log where user_id in (${f.anna.userId}, ${f.timur.userId})`;
        const eventRequests = await f.sql<
          { id: string }[]
        >`select id from requests where student_id = ${f.anna.studentId} and type_code = 'event_release'`;
        for (const row of eventRequests) {
          await f.sql`delete from staff_audit_log where request_id = ${row.id}`;
          await f.sql`delete from notifications where link = ${`/requests/${row.id}`}`;
          await f.sql`delete from requests where id = ${row.id}`;
        }
        await f.sql`delete from activity_points where student_id = ${f.anna.studentId}`;
        await f.sql`delete from attendance_records where student_id = ${f.anna.studentId}`;
      } finally {
        await f.close();
      }
    },
  };
}
export type EventRequestFixture = Awaited<
  ReturnType<typeof openEventRequestFixture>
>;
