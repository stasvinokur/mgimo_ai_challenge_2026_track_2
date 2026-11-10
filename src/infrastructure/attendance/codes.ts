import type { Sql } from "postgres";
import type {
  AttendanceCode,
  AttendanceCodes,
} from "@/application/attendance/qr-ports";
import type { IdGenerator } from "@/application/ports/id-generator";
import type { LessonKey } from "@/domain/attendance/attendance";

export class PostgresAttendanceCodes implements AttendanceCodes {
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
  ) {}
  async issue(code: AttendanceCode) {
    await this.database()`insert into attendance_codes (id, slot_id, occurrence_date, teacher_id, code_hash, created_at, expires_at)
      values (${this.ids.next()}, ${code.slotId}, ${code.occurrenceDate}, ${code.teacherId}, ${code.codeHash}, ${code.createdAt}, ${code.expiresAt})`;
  }
  async findActive(hash: string, now: string): Promise<AttendanceCode | null> {
    const [row] = await this.database()<
      (Omit<AttendanceCode, "createdAt" | "expiresAt"> & {
        createdAt: Date;
        expiresAt: Date;
      })[]
    >`
      select slot_id as "slotId", occurrence_date::text as "occurrenceDate", teacher_id as "teacherId", code_hash as "codeHash", created_at as "createdAt", expires_at as "expiresAt"
      from attendance_codes where code_hash = ${hash} and created_at <= ${now}::timestamptz and expires_at > ${now}::timestamptz`;
    return row
      ? {
          ...row,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        }
      : null;
  }
  async revokeForLesson(key: LessonKey) {
    await this.database()`delete from attendance_codes where slot_id = ${key.slotId} and occurrence_date = ${key.occurrenceDate}`;
  }
}
