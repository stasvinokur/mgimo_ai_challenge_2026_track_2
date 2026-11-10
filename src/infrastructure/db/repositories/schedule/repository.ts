import type { Sql } from "postgres";
import type {
  CalendarTokenStore,
  ScheduleRepository,
} from "@/application/schedule/ports";
import type {
  ScheduleChange,
  ScheduleData,
  ScheduleSlot,
} from "@/domain/schedule/schedule";

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly database: () => Sql) {}

  async findForStudent(studentId: string): Promise<ScheduleData | null> {
    const sql = this.database();
    const [profile] = await sql<
      { group: string }[]
    >`select g.title as "group" from students s join groups g on g.id = s.group_id where s.id = ${studentId}`;
    if (!profile) return null;
    const slots = await sql<ScheduleSlot[]>`
      select sl.id, c.title as course, t.full_name as teacher, r.title as room,
        sl.weekday, sl.starts_at as "startsAt", sl.ends_at as "endsAt", sl.kind, sl.week_parity as "weekParity"
      from schedule_slots sl join students s on s.group_id = sl.group_id
      join courses c on c.id = sl.course_id join teachers t on t.id = sl.teacher_id join rooms r on r.id = sl.room_id
      where s.id = ${studentId}`;
    const rows = await sql<
      (Omit<ScheduleChange, "createdAt"> & { createdAt: Date })[]
    >`
      select ch.id, ch.slot_id as "slotId", ch.date::text, ch.kind,
        ch.old_starts_at as "oldStartsAt", ch.old_ends_at as "oldEndsAt", old_r.title as "oldRoom", old_t.full_name as "oldTeacher",
        ch.new_date::text as "newDate", ch.new_starts_at as "newStartsAt", ch.new_ends_at as "newEndsAt", new_r.title as "newRoom", new_t.full_name as "newTeacher",
        ch.reason, ch.created_at as "createdAt"
      from schedule_changes ch join schedule_slots sl on sl.id = ch.slot_id join students s on s.group_id = sl.group_id
      left join rooms old_r on old_r.id = ch.old_room_id left join rooms new_r on new_r.id = ch.new_room_id
      left join teachers old_t on old_t.id = ch.old_teacher_id left join teachers new_t on new_t.id = ch.new_teacher_id
      where s.id = ${studentId}`;
    return {
      group: profile.group,
      slots,
      changes: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

export class PostgresCalendarTokenStore implements CalendarTokenStore {
  constructor(private readonly database: () => Sql) {}

  async replaceForStudent(
    studentId: string,
    id: string,
    tokenHash: string,
  ): Promise<void> {
    await this.database()`insert into calendar_tokens (id, student_id, token_hash) values (${id}, ${studentId}, ${tokenHash}) on conflict (student_id) do update set token_hash = excluded.token_hash`;
  }

  async findStudentByHash(tokenHash: string): Promise<string | null> {
    const [record] = await this.database()<
      { studentId: string }[]
    >`select student_id as "studentId" from calendar_tokens where token_hash = ${tokenHash}`;
    return record?.studentId ?? null;
  }
}
