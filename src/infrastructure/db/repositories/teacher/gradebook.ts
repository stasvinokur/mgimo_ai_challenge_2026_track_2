import type { Sql } from "postgres";
import type { IdGenerator } from "@/application/ports/id-generator";
import { NotFoundError } from "@/application/shared/errors";
import type {
  GradebookContext,
  GradebookEntry,
  GradebookReadContext,
  GradebookReference,
  GradebookRoster,
  TeacherGradebooks,
  TeacherGradebookUnitOfWork,
} from "@/application/teacher/gradebook-ports";
import type { LessonKey } from "@/domain/attendance/attendance";
import { canGradeReplacement } from "@/domain/grades/score-change";
import { reasonLabel } from "@/domain/grades/score-reasons";
import { addDays, weekday } from "@/domain/schedule/dates";
import { PostgresTeacherScheduleRepository } from "./repository";

export class PostgresTeacherGradebooks implements TeacherGradebooks {
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
  ) {}

  async isBaseTeacherForLesson(key: LessonKey, teacherId: string) {
    const sql = this.database();
    const [slot] = await sql<{ own: boolean }[]>`
      select teacher_id = ${teacherId} as own
      from schedule_slots where id = ${key.slotId}`;
    return slot?.own ?? false;
  }

  private async ownLesson(key: LessonKey, teacherId: string) {
    const lesson = await new PostgresTeacherScheduleRepository(
      this.database,
    ).findLessonForTeacher(key, teacherId);
    if (!lesson) throw new NotFoundError();
    return lesson;
  }

  async listForTeacher(teacherId: string, referenceDate: string) {
    const sql = this.database();
    const slots = await sql<
      {
        id: string;
        weekday: number;
        courseId: string;
        groupId: string;
        teacherId: string;
      }[]
    >`
      select sl.id, sl.weekday, sl.course_id as "courseId", sl.group_id as "groupId", sl.teacher_id as "teacherId"
      from schedule_slots sl
      where sl.teacher_id = ${teacherId} or exists (
        select 1 from schedule_changes ch
        where ch.slot_id = sl.id and ch.new_teacher_id = ${teacherId})
      order by sl.id`;
    if (!slots.length) return [];
    const replacements = await sql<
      { slotId: string; occurrenceDate: string }[]
    >`
      select distinct slot_id as "slotId", date::text as "occurrenceDate"
      from schedule_changes where slot_id in ${sql(slots.map((slot) => slot.id))}
      order by "slotId", "occurrenceDate"`;
    const schedule = new PostgresTeacherScheduleRepository(this.database);
    const books = new Map<string, GradebookReference>();
    for (const slot of slots) {
      const candidates = Array.from({ length: 14 }, (_, offset) =>
        addDays(referenceDate, offset),
      ).filter((date) => weekday(date) === slot.weekday);
      candidates.push(
        ...replacements
          .filter((change) => change.slotId === slot.id)
          .map((change) => change.occurrenceDate),
      );
      for (const occurrenceDate of new Set(candidates)) {
        const lesson = await schedule.findLessonForTeacher(
          { slotId: slot.id, occurrenceDate },
          teacherId,
        );
        if (!lesson) continue;
        if (
          slot.teacherId !== teacherId &&
          !canGradeReplacement(lesson.date, referenceDate)
        )
          continue;
        const key = `${slot.courseId}:${slot.groupId}`;
        if (!books.has(key))
          books.set(key, {
            slotId: slot.id,
            occurrenceDate,
            course: lesson.course,
            group: lesson.group,
          });
      }
    }
    return [...books.values()].sort(
      (a, b) =>
        a.course.localeCompare(b.course, "ru-RU") ||
        a.group.localeCompare(b.group, "ru-RU"),
    );
  }

  async getForTeacherLesson(
    key: LessonKey,
    teacherId: string,
  ): Promise<GradebookRoster> {
    await this.ownLesson(key, teacherId);
    const sql = this.database();
    const [slot] = await sql<{ courseId: string; groupId: string }[]>`
      select course_id as "courseId", group_id as "groupId"
      from schedule_slots where id = ${key.slotId}`;
    if (!slot) throw new NotFoundError();
    const works = await sql<GradebookRoster["works"]>`
      select id, title, max_score as "maxScore" from assessments
      where course_id = ${slot.courseId} and group_id = ${slot.groupId}
      order by due_at, id`;
    const students = await sql<
      { key: string; fullName: string; group: string }[]
    >`
      select md5(s.id::text) as key, s.full_name as "fullName", g.title as "group"
      from students s join groups g on g.id = s.group_id
      where s.group_id = ${slot.groupId} order by s.full_name, s.id`;
    const entries = await sql<
      (GradebookRoster["students"][number]["entries"][number] & {
        studentKey: string;
      })[]
    >`
      select md5(a.id::text || ':' || s.id::text) as key,
        md5(s.id::text) as "studentKey", a.id as "assessmentId", sc.score
      from assessments a join students s on s.group_id = a.group_id
      left join scores sc on sc.assessment_id = a.id and sc.student_id = s.id
      where a.course_id = ${slot.courseId} and a.group_id = ${slot.groupId}
      order by a.due_at, a.id`;
    return {
      courseId: slot.courseId,
      works,
      students: students.map((student) => ({
        ...student,
        entries: entries
          .filter((entry) => entry.studentKey === student.key)
          .map(({ studentKey: _studentKey, ...entry }) => entry),
      })),
    };
  }

  async findEntryForTeacherLesson(
    key: LessonKey,
    teacherId: string,
    entryKey: string,
  ): Promise<GradebookEntry | null> {
    return this.entryForTeacherLesson(key, teacherId, entryKey, true);
  }

  async readEntryForTeacherLesson(
    key: LessonKey,
    teacherId: string,
    entryKey: string,
  ): Promise<GradebookEntry | null> {
    return this.entryForTeacherLesson(key, teacherId, entryKey, false);
  }

  private async entryForTeacherLesson(
    key: LessonKey,
    teacherId: string,
    entryKey: string,
    lock: boolean,
  ): Promise<GradebookEntry | null> {
    await this.ownLesson(key, teacherId);
    const sql = this.database();
    const [entry] = await sql<GradebookEntry[]>`
      select a.id as "assessmentId", s.id as "studentId", s.user_id as "studentUserId",
        a.course_id as "courseId", c.title as "courseTitle", a.title as "workTitle",
        a.max_score as "maxScore", sc.score
      from schedule_slots sl
      join assessments a on a.course_id = sl.course_id and a.group_id = sl.group_id
      join courses c on c.id = a.course_id
      join students s on s.group_id = sl.group_id
      left join scores sc on sc.assessment_id = a.id and sc.student_id = s.id
      where sl.id = ${key.slotId} and md5(a.id::text || ':' || s.id::text) = ${entryKey}
      ${lock ? sql`for share of sl, a, s` : sql``}`;
    return entry ?? null;
  }

  async recordChange(input: Parameters<TeacherGradebooks["recordChange"]>[0]) {
    const sql = this.database();
    const { entry } = input;
    await sql`
      insert into scores (id, assessment_id, student_id, score, graded_at)
      values (${this.ids.next()}, ${entry.assessmentId}, ${entry.studentId}, ${input.score}, ${input.at}::timestamptz)
      on conflict (student_id, assessment_id) do update
      set score = excluded.score, graded_at = excluded.graded_at`;
    await sql`
      insert into score_events (id, assessment_id, student_id, student_user_id,
        previous_score, new_score, changed_by_user_id, reason, created_at)
      values (${input.eventId}, ${entry.assessmentId}, ${entry.studentId}, ${entry.studentUserId},
        ${entry.score}, ${input.score}, ${input.changedByUserId}, ${input.reason}, ${input.at}::timestamptz)`;
    if (entry.studentUserId)
      await sql`
        insert into notifications (id, user_id, kind, title, body, link, created_at)
        values (${input.notificationId}, ${entry.studentUserId}, 'change',
          ${`Новая оценка: ${entry.courseTitle} — ${entry.workTitle}`},
          ${`Балл: ${input.score} из ${entry.maxScore}.${input.reason ? ` Причина: ${reasonLabel(input.reason)}` : ""}`},
          ${`/grades/${entry.courseId}`}, ${input.at}::timestamptz)`;
  }
}

export class PostgresTeacherGradebookUnitOfWork
  implements TeacherGradebookUnitOfWork
{
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
  ) {}

  async read<T>(
    work: (context: GradebookReadContext) => Promise<T>,
  ): Promise<T> {
    return (await this.database().begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        const sql = transaction as unknown as Sql;
        return work({
          books: new PostgresTeacherGradebooks(() => sql, this.ids),
          teacherSchedule: new PostgresTeacherScheduleRepository(() => sql),
        });
      },
    )) as T;
  }

  async run<T>(work: (context: GradebookContext) => Promise<T>): Promise<T> {
    return (await this.database().begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      return work({
        books: new PostgresTeacherGradebooks(() => sql, this.ids),
        teacherSchedule: new PostgresTeacherScheduleRepository(() => sql),
        async lockLesson(key) {
          // Slot lock also blocks new changes through their foreign key.
          await sql`select id from schedule_slots where id = ${key.slotId} for update`;
          await sql`select id from schedule_changes where slot_id = ${key.slotId} for share`;
        },
        async lockEntry(entryKey) {
          await sql`select pg_advisory_xact_lock(hashtextextended(${`gradebook:${entryKey}`}, 0))`;
        },
      });
    })) as T;
  }
}
