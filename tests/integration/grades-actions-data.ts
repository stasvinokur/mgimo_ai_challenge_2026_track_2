import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import type { StudentTestData } from "./student-e2e-data";

export function gradesActionDeadline(value: string) {
  const date = new Date(value);
  const options = {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  } as const;
  return {
    label: new Intl.DateTimeFormat("ru-RU", {
      ...options,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
    date: new Intl.DateTimeFormat("ru-RU", options).format(date),
    time: new Intl.DateTimeFormat("ru-RU", {
      timeZone: options.timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  };
}

export async function isolateGradesForTest(student: StudentTestData) {
  if (student.actor.kind !== "student") throw new Error("Нужен студент.");
  const studentId = student.actor.studentId;
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const groupId = ids.next();
  const courseId = ids.next();
  const workId = ids.next();
  const gradedId = ids.next();
  const workTitle = `Индивидуальная работа ${workId}`;
  const dueAt = "2019-04-17T20:17:00.000Z";
  try {
    const originalGroupId = await sql.begin(async (tx) => {
      const [row] = await tx<
        { groupId: string }[]
      >`select group_id as "groupId" from students where id = ${studentId}`;
      if (!row) throw new Error("Нет временного студента.");
      await tx`insert into groups (id, program_id, title) select ${groupId}, program_id, ${`Тестовая группа ${groupId}`} from students where id = ${studentId}`;
      await tx`insert into courses (id, title) values (${courseId}, 'Основы маркетинга')`;
      await tx`insert into assessments (id, course_id, group_id, kind, title, weight, max_score, is_required, due_at)
        values (${workId}, ${courseId}, ${groupId}, 'control', ${workTitle}, 60, 100, true, ${dueAt}::timestamptz),
          (${gradedId}, ${courseId}, ${groupId}, 'essay', 'Оценённая работа', 40, 100, true, '2019-04-10T10:00:00Z'::timestamptz)`;
      await tx`insert into scores (id, assessment_id, student_id, score, graded_at) values (${ids.next()}, ${gradedId}, ${studentId}, 72, '2019-04-11T10:00:00Z'::timestamptz)`;
      await tx`update students set group_id = ${groupId} where id = ${studentId}`;
      return row.groupId;
    });
    return {
      courseId,
      workId,
      workTitle,
      dueAt,
      async close() {
        try {
          await sql.begin(async (tx) => {
            await tx`update students set group_id = ${originalGroupId} where id = ${studentId}`;
            await tx`delete from scores where assessment_id in (${workId}, ${gradedId})`;
            await tx`delete from assessments where course_id = ${courseId}`;
            await tx`delete from courses where id = ${courseId}`;
            await tx`delete from groups where id = ${groupId}`;
          });
        } finally {
          await sql.end({ timeout: 1 });
        }
      },
    };
  } catch (error) {
    await sql.end({ timeout: 1 });
    throw error;
  }
}
