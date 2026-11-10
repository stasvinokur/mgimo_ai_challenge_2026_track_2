import type { Sql } from "postgres";
import type {
  AttendanceRecords,
  AttendanceRosterEntry,
} from "@/application/attendance/ports";
import type { IdGenerator } from "@/application/ports/id-generator";
import { NotFoundError, ValidationError } from "@/application/shared/errors";
import type {
  AttendanceRecord,
  LessonKey,
} from "@/domain/attendance/attendance";
import { buildSchedule, isActive } from "@/domain/schedule/schedule";
import { PostgresScheduleRepository } from "../schedule/repository";
import { PostgresTeacherScheduleRepository } from "../teacher/repository";

type Row = Omit<AttendanceRecord, "markedAt"> & { markedAt: Date };
const record = (row: Row): AttendanceRecord => ({
  ...row,
  markedAt: row.markedAt.toISOString(),
});

export class PostgresAttendanceRecords implements AttendanceRecords {
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
  ) {}

  private async assertStudentLesson(studentId: string, key: LessonKey) {
    const data = await new PostgresScheduleRepository(
      this.database,
    ).findForStudent(studentId);
    if (!data) throw new NotFoundError();
    const target =
      data.changes
        .filter(
          (ch) =>
            ch.slotId === key.slotId &&
            ch.date === key.occurrenceDate &&
            ch.newDate,
        )
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        )
        .at(-1)?.newDate ?? key.occurrenceDate;
    if (
      !buildSchedule(data, target, target).some(
        (lesson) =>
          lesson.id === `${key.slotId}:${key.occurrenceDate}` &&
          isActive(lesson),
      )
    )
      throw new NotFoundError();
  }

  private async mark(
    studentId: string,
    key: LessonKey,
    input: { sourceKey: string; markedAt: string; reason?: string },
    status: "present" | "excused",
  ) {
    await this.assertStudentLesson(studentId, key);
    if (status === "excused" && !input.reason?.trim())
      throw new ValidationError({ reason: ["Укажите причину отсутствия."] });
    const [row] = await this.database()<Row[]>`
      insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key, reason, marked_at)
      values (${this.ids.next()}, ${studentId}, ${key.slotId}, ${key.occurrenceDate}, ${status}, ${status === "present" ? "qr" : "excuse"}, ${input.sourceKey}, ${input.reason ?? null}, ${input.markedAt})
      on conflict (student_id, slot_id, occurrence_date) do update set
        status = case when attendance_records.status = 'present' or attendance_records.status = excluded.status and attendance_records.source_key = excluded.source_key then attendance_records.status else excluded.status end,
        source = case when attendance_records.status = 'present' or attendance_records.status = excluded.status and attendance_records.source_key = excluded.source_key then attendance_records.source else excluded.source end,
        source_key = case when attendance_records.status = 'present' or attendance_records.status = excluded.status and attendance_records.source_key = excluded.source_key then attendance_records.source_key else excluded.source_key end,
        reason = case when attendance_records.status = 'present' or attendance_records.status = excluded.status and attendance_records.source_key = excluded.source_key then attendance_records.reason else excluded.reason end,
        marked_at = case when attendance_records.status = 'present' or attendance_records.status = excluded.status and attendance_records.source_key = excluded.source_key then attendance_records.marked_at else excluded.marked_at end
      returning id, slot_id as "slotId", occurrence_date::text as "occurrenceDate", status, source, source_key as "sourceKey", reason, marked_at as "markedAt"`;
    if (!row) throw new NotFoundError();
    return record(row);
  }

  markPresentForStudent(
    studentId: string,
    key: LessonKey,
    input: { sourceKey: string; markedAt: string },
  ) {
    return this.mark(studentId, key, input, "present");
  }

  markExcusedForStudent(
    studentId: string,
    key: LessonKey,
    input: { sourceKey: string; reason: string; markedAt: string },
  ) {
    return this.mark(studentId, key, input, "excused");
  }

  async awardActivityForStudent(
    studentId: string,
    input: { sourceKey: string; points: number; createdAt: string },
  ) {
    if (!Number.isSafeInteger(input.points) || input.points <= 0)
      throw new ValidationError({
        points: ["Баллы должны быть положительным целым числом."],
      });
    await this.database()`insert into activity_points (id, student_id, source_key, points, created_at)
      values (${this.ids.next()}, ${studentId}, ${input.sourceKey}, ${input.points}, ${input.createdAt}) on conflict (student_id, source_key) do nothing`;
  }

  async listForStudent(studentId: string, from: string, to: string) {
    const sql = this.database();
    const rows = await sql<
      Row[]
    >`select id, slot_id as "slotId", occurrence_date::text as "occurrenceDate", status, source, source_key as "sourceKey", reason, marked_at as "markedAt"
      from attendance_records where student_id = ${studentId} and occurrence_date between ${from} and ${to} order by occurrence_date, slot_id`;
    const [total] = await sql<
      { points: string }[]
    >`select coalesce(sum(points), 0)::text as points from activity_points where student_id = ${studentId}`;
    return {
      records: rows.map(record),
      activityPoints: Number(total?.points ?? 0),
    };
  }

  async listRosterForTeacherLesson(
    key: LessonKey,
    teacherId: string,
  ): Promise<AttendanceRosterEntry[]> {
    const lesson = await new PostgresTeacherScheduleRepository(
      this.database,
    ).findLessonForTeacher(key, teacherId);
    if (!lesson) throw new NotFoundError();
    return this.database()<AttendanceRosterEntry[]>`
      select s.full_name as "fullName", g.title as "group", a.status,
        case when a.status = 'excused' then a.reason else null end as reason
      from schedule_slots sl join students s on s.group_id = sl.group_id join groups g on g.id = s.group_id
      left join attendance_records a on a.student_id = s.id and a.slot_id = sl.id and a.occurrence_date = ${key.occurrenceDate}
      where sl.id = ${key.slotId} order by s.full_name, s.id`;
  }

  async closeForTeacherLesson(
    key: LessonKey,
    teacherId: string,
    markedAt: string,
  ) {
    const lesson = await new PostgresTeacherScheduleRepository(
      this.database,
    ).findLessonForTeacher(key, teacherId);
    if (!lesson || !isActive(lesson)) throw new NotFoundError();
    const students = await this.database()<{ id: string }[]>`
      select s.id from students s join schedule_slots sl on sl.group_id = s.group_id where sl.id = ${key.slotId}`;
    for (const student of students) {
      await this.database()`insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key, marked_at)
        values (${this.ids.next()}, ${student.id}, ${key.slotId}, ${key.occurrenceDate}, 'absent', 'qr', ${`closed:${key.slotId}:${key.occurrenceDate}`}, ${markedAt})
        on conflict (student_id, slot_id, occurrence_date) do nothing`;
    }
  }

  async listForTeacherLesson(key: LessonKey, teacherId: string) {
    const lesson = await new PostgresTeacherScheduleRepository(
      this.database,
    ).findLessonForTeacher(key, teacherId);
    if (!lesson) throw new NotFoundError();
    return this.database()<
      { fullName: string; group: string; status: AttendanceRecord["status"] }[]
    >`
      select s.full_name as "fullName", g.title as "group", a.status from attendance_records a
      join students s on s.id = a.student_id join groups g on g.id = s.group_id
      where a.slot_id = ${key.slotId} and a.occurrence_date = ${key.occurrenceDate} order by s.full_name`;
  }
}
