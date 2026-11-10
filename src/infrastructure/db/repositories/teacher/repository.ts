import type { Sql } from "postgres";
import type {
  TeacherLesson,
  TeacherScheduleRepository,
} from "@/application/teacher/ports";
import type { LessonKey } from "@/domain/attendance/attendance";
import type { ScheduleChange, ScheduleSlot } from "@/domain/schedule/schedule";
import { buildSchedule } from "@/domain/schedule/schedule";

type Slot = ScheduleSlot & { teacherId: string; group: string };
type Change = Omit<ScheduleChange, "createdAt"> & {
  createdAt: Date;
  newTeacherId: string | null;
};

export class PostgresTeacherScheduleRepository
  implements TeacherScheduleRepository
{
  constructor(private readonly database: () => Sql) {}

  private async load(teacherId: string) {
    const sql = this.database();
    // Include replaced slots, then authorize each occurrence by its effective id.
    const slots = await sql<Slot[]>`
      select sl.id, c.title as course, t.full_name as teacher, r.title as room,
        sl.teacher_id as "teacherId", g.title as "group", sl.weekday,
        sl.starts_at as "startsAt", sl.ends_at as "endsAt", sl.kind, sl.week_parity as "weekParity"
      from schedule_slots sl join courses c on c.id = sl.course_id
      join teachers t on t.id = sl.teacher_id join rooms r on r.id = sl.room_id join groups g on g.id = sl.group_id
      where sl.teacher_id = ${teacherId} or exists (
        select 1 from schedule_changes ch where ch.slot_id = sl.id and ch.new_teacher_id = ${teacherId})`;
    const slotIds = slots.map((slot) => slot.id);
    if (!slotIds.length) return { slots, changes: [] as Change[] };
    const changes = await sql<Change[]>`
      select ch.id, ch.slot_id as "slotId", ch.date::text, ch.kind,
        ch.old_starts_at as "oldStartsAt", ch.old_ends_at as "oldEndsAt", old_r.title as "oldRoom", old_t.full_name as "oldTeacher",
        ch.new_date::text as "newDate", ch.new_starts_at as "newStartsAt", ch.new_ends_at as "newEndsAt", new_r.title as "newRoom", new_t.full_name as "newTeacher",
        ch.new_teacher_id as "newTeacherId", ch.reason, ch.created_at as "createdAt"
      from schedule_changes ch
      left join rooms old_r on old_r.id = ch.old_room_id left join rooms new_r on new_r.id = ch.new_room_id
      left join teachers old_t on old_t.id = ch.old_teacher_id left join teachers new_t on new_t.id = ch.new_teacher_id
      where ch.slot_id in ${sql(slotIds)} order by ch.created_at, ch.id`;
    return { slots, changes };
  }

  private build(
    data: Awaited<ReturnType<PostgresTeacherScheduleRepository["load"]>>,
    teacherId: string,
    from: string,
    to: string,
  ): TeacherLesson[] {
    const lessons: TeacherLesson[] = [];
    for (const slot of data.slots) {
      const changes = data.changes.filter((ch) => ch.slotId === slot.id);
      const built = buildSchedule(
        {
          group: slot.group,
          slots: [slot],
          changes: changes.map((ch) => ({
            ...ch,
            createdAt: ch.createdAt.toISOString(),
          })),
        },
        from,
        to,
      );
      for (const lesson of built) {
        const occurrenceDate = lesson.id.slice(-10);
        let owner = slot.teacherId;
        for (const ch of changes) {
          if (ch.date === occurrenceDate && ch.newTeacherId)
            owner = ch.newTeacherId;
        }
        if (owner === teacherId) lessons.push({ ...lesson, group: slot.group });
      }
    }
    return lessons.sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
  }

  async listForTeacher(teacherId: string, from: string, to: string) {
    return this.build(await this.load(teacherId), teacherId, from, to);
  }

  async findLessonForTeacher(key: LessonKey, teacherId: string) {
    const data = await this.load(teacherId);
    const relevant = data.changes.filter(
      (ch) => ch.slotId === key.slotId && ch.date === key.occurrenceDate,
    );
    const target =
      relevant.filter((ch) => ch.newDate).at(-1)?.newDate ?? key.occurrenceDate;
    return (
      this.build(data, teacherId, target, target).find(
        (lesson) =>
          lesson.id === `${key.slotId}:${key.occurrenceDate}` &&
          lesson.status !== "moved-from",
      ) ?? null
    );
  }
}
