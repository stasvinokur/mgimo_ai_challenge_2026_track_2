import type { Sql } from "postgres";
import type { AttendanceRecords } from "@/application/attendance/ports";
import type {
  AttendanceContext,
  AttendanceUnitOfWork,
} from "@/application/attendance/qr-ports";
import type { IdGenerator } from "@/application/ports/id-generator";
import { PostgresScheduleRepository } from "@/infrastructure/db/repositories/schedule/repository";
import { PostgresTeacherScheduleRepository } from "@/infrastructure/db/repositories/teacher/repository";
import { PostgresAttendanceCodes } from "./codes";

export class PostgresAttendanceUnitOfWork implements AttendanceUnitOfWork {
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
    private readonly records: (sql: Sql) => AttendanceRecords,
  ) {}
  async run<T>(work: (context: AttendanceContext) => Promise<T>): Promise<T> {
    return (await this.database().begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      return work({
        records: this.records(sql),
        codes: new PostgresAttendanceCodes(() => sql, this.ids),
        schedule: new PostgresScheduleRepository(() => sql),
        teacherSchedule: new PostgresTeacherScheduleRepository(() => sql),
        async lockLesson(key) {
          await sql`select pg_advisory_xact_lock(hashtextextended(${`attendance:${key.slotId}:${key.occurrenceDate}`}, 0))`;
        },
      });
    })) as T;
  }
}
