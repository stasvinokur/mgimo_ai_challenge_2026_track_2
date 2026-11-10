import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  RequestEventRecord,
  RequestRecord,
  RequestRepository,
} from "@/application/requests/ports";
import { ConflictError, NotFoundError } from "@/domain/shared/errors";
import type * as schema from "../../schema";
import { users } from "../../schema/identity";
import { requestEvents, requests, requestTypes } from "../../schema/requests";
import {
  faculties,
  groups,
  programs,
  staff,
  students,
} from "../../schema/student";

export type RequestsDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export class DrizzleRequestRepository implements RequestRepository {
  constructor(private readonly database: () => RequestsDatabase) {}

  async isDemoAccount(userId: string) {
    const [user] = await this.database()
      .select({ seedKey: users.seedKey })
      .from(users)
      .where(eq(users.id, userId));
    return user?.seedKey != null;
  }

  async listTypes() {
    return this.database()
      .select()
      .from(requestTypes)
      .orderBy(asc(requestTypes.code));
  }
  async findType(code: string) {
    return (
      (
        await this.database()
          .select()
          .from(requestTypes)
          .where(eq(requestTypes.code, code))
      )[0] ?? null
    );
  }
  async findProfileForStudent(studentId: string) {
    return (
      (
        await this.database()
          .select({
            fullName: students.fullName,
            faculty: faculties.title,
            program: programs.title,
            course: students.course,
            group: groups.title,
            recordBookNo: students.recordBookNo,
            scholarship: students.scholarship,
          })
          .from(students)
          .innerJoin(faculties, eq(students.facultyId, faculties.id))
          .innerJoin(programs, eq(students.programId, programs.id))
          .innerJoin(groups, eq(students.groupId, groups.id))
          .where(eq(students.id, studentId))
      )[0] ?? null
    );
  }
  private rows() {
    return this.database()
      .select({
        request: requests,
        facultyId: students.facultyId,
        studentUserId: students.userId,
        assignee: staff.fullName,
      })
      .from(requests)
      .innerJoin(students, eq(students.id, requests.studentId))
      .leftJoin(staff, eq(staff.id, requests.assigneeStaffId));
  }
  private record(
    row: Awaited<ReturnType<DrizzleRequestRepository["rows"]>>[number],
  ): RequestRecord {
    const r = row.request;
    return {
      id: r.id,
      publicNo: r.publicNo,
      studentId: r.studentId,
      typeCode: r.typeCode,
      payload: r.payload,
      status: r.status,
      facultyId: row.facultyId,
      studentUserId: row.studentUserId,
      assignee: row.assignee,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      dueAt: r.dueAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
  async listForStudent(studentId: string) {
    return (
      await this.rows()
        .where(eq(requests.studentId, studentId))
        .orderBy(desc(requests.createdAt), desc(requests.id))
    ).map((row) => this.record(row));
  }
  async findByIdForStudent(id: string, studentId: string, lock = false) {
    const filter = and(eq(requests.id, id), eq(requests.studentId, studentId));
    if (lock)
      await this.database()
        .select({ id: requests.id })
        .from(requests)
        .where(filter)
        .for("update");
    const row = (await this.rows().where(filter))[0];
    return row ? this.record(row) : null;
  }
  async findOldestUnseededDraftForStudent(studentId: string, lock = false) {
    const query = this.database()
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.studentId, studentId),
          eq(requests.status, "draft"),
          isNull(requests.seedKey),
        ),
      )
      .orderBy(asc(requests.createdAt), asc(requests.id))
      .limit(1);
    const [candidate] = await (lock ? query.for("update") : query);
    if (!candidate) return null;
    const record = await this.findByIdForStudent(candidate.id, studentId);
    return record?.status === "draft" ? record : null;
  }
  async lockUsageForStudent(studentId: string, since: string) {
    // The owner row serializes creation and submission, including an empty queue.
    const [owner] = await this.database()
      .select({ id: students.id })
      .from(students)
      .where(eq(students.id, studentId))
      .for("update");
    if (!owner) throw new NotFoundError();
    const [usage] = await this.database()
      .select({
        openDrafts:
          sql<number>`count(*) filter (where ${requests.status} = 'draft')`.mapWith(
            Number,
          ),
        submissions:
          sql<number>`count(*) filter (where ${requests.submittedAt} > ${since}::timestamptz and ${requests.submittedAt} <= ${since}::timestamptz + interval '24 hours')`.mapWith(
            Number,
          ),
      })
      .from(requests)
      .where(eq(requests.studentId, studentId));
    return usage ?? { openDrafts: 0, submissions: 0 };
  }
  async findByIdForFaculties(
    id: string,
    facultyIds: readonly string[],
    lock = false,
  ) {
    if (!facultyIds.length) return null;
    const filter = and(
      eq(requests.id, id),
      inArray(students.facultyId, [...facultyIds]),
      ne(requests.status, "draft"),
    );
    if (lock)
      await this.database()
        .select({ id: requests.id })
        .from(requests)
        .innerJoin(students, eq(students.id, requests.studentId))
        .where(filter)
        .for("update", { of: requests });
    const row = (await this.rows().where(filter))[0];
    return row ? this.record(row) : null;
  }
  async listEventsForStudent(id: string, studentId: string) {
    return (
      await this.database()
        .select({ event: requestEvents })
        .from(requestEvents)
        .innerJoin(requests, eq(requests.id, requestEvents.requestId))
        .where(and(eq(requests.id, id), eq(requests.studentId, studentId)))
        .orderBy(asc(requestEvents.at), asc(requestEvents.id))
    ).map(({ event }) => ({ ...event, at: event.at.toISOString() }));
  }
  async createDraft(record: RequestRecord) {
    await this.database()
      .insert(requests)
      .values({
        id: record.id,
        publicNo: record.publicNo,
        studentId: record.studentId,
        typeCode: record.typeCode,
        payload: record.payload,
        status: "draft",
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
  }
  async save(
    record: RequestRecord,
    expected: RequestRecord,
    assigneeStaffId?: string,
  ) {
    const saved = await this.database()
      .update(requests)
      .set({
        publicNo: record.publicNo,
        payload: record.payload,
        status: record.status,
        submittedAt: record.submittedAt ? new Date(record.submittedAt) : null,
        dueAt: record.dueAt ? new Date(record.dueAt) : null,
        updatedAt: new Date(record.updatedAt),
        ...(assigneeStaffId ? { assigneeStaffId } : {}),
      })
      .where(
        and(
          eq(requests.id, record.id),
          eq(requests.studentId, expected.studentId),
          eq(requests.status, expected.status),
          eq(requests.updatedAt, new Date(expected.updatedAt)),
        ),
      )
      .returning({ id: requests.id });
    if (!saved.length) throw new ConflictError();
  }
  async deleteDraftForStudent(id: string, studentId: string) {
    const deleted = await this.database()
      .delete(requests)
      .where(
        and(
          eq(requests.id, id),
          eq(requests.studentId, studentId),
          eq(requests.status, "draft"),
        ),
      )
      .returning({ id: requests.id });
    if (!deleted.length) throw new ConflictError();
  }
  async nextPublicNo(year: number) {
    // All submitters hold this transaction lock until the numbered row is saved.
    await this.database().execute(
      sql`select pg_advisory_xact_lock(13213, ${year})`,
    );
    const [row] = await this.database()
      .select({
        value: sql<number>`coalesce(max(substring(${requests.publicNo} from 8)::integer), 0) + 1`,
      })
      .from(requests)
      .where(sql`${requests.publicNo} ~ ${`^З-${year}-[0-9]{6,}$`}`);
    if (!row) throw new ConflictError();
    return `З-${year}-${String(row.value).padStart(6, "0")}`;
  }
  async appendEvent(event: RequestEventRecord) {
    await this.database()
      .insert(requestEvents)
      .values({ ...event, at: new Date(event.at) });
  }
}
