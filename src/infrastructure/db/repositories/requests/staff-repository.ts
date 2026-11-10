import { and, asc, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import type { Sql } from "postgres";
import type {
  StaffEventContext,
  StaffRequestRecord,
  StaffRequestRepository,
} from "@/application/staff/ports";
import { staffAuditLog } from "../../schema/audit";
import { users } from "../../schema/identity";
import { requestEvents, requests, requestTypes } from "../../schema/requests";
import { faculties, groups, staff, students } from "../../schema/student";
import { PostgresScheduleRepository } from "../schedule/repository";
import type { RequestsDatabase } from "./repository";

export async function isDemoStaffUser(
  database: RequestsDatabase,
  userId: string,
) {
  const [row] = await database
    .select({ seedKey: users.seedKey })
    .from(users)
    .where(eq(users.id, userId));
  return row?.seedKey != null;
}

export class DrizzleStaffRequestRepository implements StaffRequestRepository {
  constructor(
    private readonly database: () => RequestsDatabase & { $client: Sql },
  ) {}
  async isDemoUser(userId: string) {
    return isDemoStaffUser(this.database(), userId);
  }
  async listTypes() {
    return this.database()
      .select()
      .from(requestTypes)
      .orderBy(asc(requestTypes.code));
  }
  private scope(facultyIds: readonly string[]) {
    return and(
      inArray(students.facultyId, [...facultyIds]),
      ne(requests.status, "draft"),
    );
  }
  private rows() {
    return this.database()
      .select({
        request: requests,
        facultyId: students.facultyId,
        studentUserId: students.userId,
        assignee: staff.fullName,
        student: {
          fullName: students.fullName,
          group: groups.title,
          faculty: faculties.title,
        },
      })
      .from(requests)
      .innerJoin(students, eq(requests.studentId, students.id))
      .innerJoin(groups, eq(students.groupId, groups.id))
      .innerJoin(faculties, eq(students.facultyId, faculties.id))
      .leftJoin(staff, eq(requests.assigneeStaffId, staff.id));
  }
  private record(
    row: Awaited<ReturnType<DrizzleStaffRequestRepository["rows"]>>[number],
  ): StaffRequestRecord {
    const r = row.request;
    return {
      request: {
        id: r.id,
        publicNo: r.publicNo,
        studentId: r.studentId,
        facultyId: row.facultyId,
        studentUserId: row.studentUserId,
        typeCode: r.typeCode,
        payload: r.payload,
        status: r.status,
        assignee: row.assignee,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        dueAt: r.dueAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      },
      assigneeStaffId: r.assigneeStaffId,
      student: row.student,
    };
  }
  async listForFaculties(
    facultyIds: readonly string[],
    completedSince: string,
  ) {
    return (
      await this.rows().where(
        and(
          this.scope(facultyIds),
          or(
            inArray(requests.status, [
              "submitted",
              "accepted",
              "in_progress",
              "needs_info",
              "ready",
            ]),
            and(
              inArray(requests.status, ["issued", "rejected"]),
              gte(requests.updatedAt, new Date(completedSince)),
            ),
          ),
        ),
      )
    ).map((row) => this.record(row));
  }
  async findByIdForFaculties(id: string, facultyIds: readonly string[]) {
    const [row] = await this.rows().where(
      and(eq(requests.id, id), this.scope(facultyIds)),
    );
    return row ? this.record(row) : null;
  }
  async findEventContextForFaculties(
    id: string,
    facultyIds: readonly string[],
  ): Promise<StaffEventContext | null> {
    const row = await this.findByIdForFaculties(id, facultyIds);
    if (row?.request.typeCode !== "event_release") return null;
    const sql = this.database().$client;
    const schedule = await new PostgresScheduleRepository(
      () => sql,
    ).findForStudent(row.request.studentId);
    if (!schedule) return null;
    const records = await sql<
      StaffEventContext["records"]
    >`select slot_id as "slotId", occurrence_date::text as "occurrenceDate", status from attendance_records where student_id = ${row.request.studentId}`;
    return { schedule, records };
  }
  async listEventsForFaculties(id: string, facultyIds: readonly string[]) {
    return (
      await this.database()
        .select({ event: requestEvents })
        .from(requestEvents)
        .innerJoin(requests, eq(requestEvents.requestId, requests.id))
        .innerJoin(students, eq(requests.studentId, students.id))
        .where(and(eq(requests.id, id), this.scope(facultyIds)))
        .orderBy(asc(requestEvents.at), asc(requestEvents.id))
    ).map(({ event }) => ({ ...event, at: event.at.toISOString() }));
  }
  async listAuditForFaculties(id: string, facultyIds: readonly string[]) {
    return (
      await this.database()
        .select({
          id: staffAuditLog.id,
          action: staffAuditLog.action,
          at: staffAuditLog.at,
          staffName: staff.fullName,
        })
        .from(staffAuditLog)
        .innerJoin(requests, eq(staffAuditLog.requestId, requests.id))
        .innerJoin(students, eq(requests.studentId, students.id))
        .innerJoin(staff, eq(staffAuditLog.staffUserId, staff.userId))
        .where(and(eq(requests.id, id), this.scope(facultyIds)))
        .orderBy(desc(staffAuditLog.at), desc(staffAuditLog.id))
    ).map((entry) => ({ ...entry, at: entry.at.toISOString() }));
  }
}
