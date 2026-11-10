import { createHash } from "node:crypto";
import { openAttendanceTestData } from "./attendance-data";

export function teacherGradeEntryKey(assessmentId: string, studentId: string) {
  return createHash("md5").update(`${assessmentId}:${studentId}`).digest("hex");
}

export async function openTeacherGradesTestData(
  options: {
    studentNames?: readonly [string, string, string];
    teacherName?: string;
    groupTitle?: string;
    courseTitle?: string;
    lessonTime?: "around-now" | { startsAt: string; endsAt: string };
  } = {},
) {
  const attendance = await openAttendanceTestData({
    studentNames: options.studentNames ?? [
      "Студент ведомости",
      "Студент второй строки",
      "Студент без балла",
    ],
    teacherName: options.teacherName ?? "Преподаватель ведомости",
    groupTitle: options.groupTitle,
    lessonTime: options.lessonTime,
  });
  const { teacher, student, unmarked: otherStudent } = attendance;
  const { sql, ids } = teacher;
  const courseId = ids.next();
  const workId = ids.next();
  const secondWorkId = ids.next();
  const courseTitle = options.courseTitle ?? `Учебная дисциплина ${courseId}`;
  const workTitle = "Итоговый тест";
  const secondWorkTitle = "Учебное эссе";
  const [slot] = await sql<
    { courseId: string }[]
  >`select course_id as "courseId" from schedule_slots where id = ${teacher.slotId}`;
  if (!slot) {
    await attendance.close();
    throw new Error("Нет пары временного преподавателя.");
  }
  try {
    await sql.begin(async (tx) => {
      await tx`insert into courses (id, title) values (${courseId}, ${courseTitle})`;
      await tx`insert into assessments (id, course_id, group_id, kind, title, weight, max_score, is_required, due_at)
        values (${workId}, ${courseId}, ${teacher.groupId}, 'test', ${workTitle}, 50, 100, true, '2030-11-15T09:00:00Z'),
          (${secondWorkId}, ${courseId}, ${teacher.groupId}, 'essay', ${secondWorkTitle}, 50, 100, true, '2030-11-16T09:00:00Z')`;
      await tx`insert into scores (id, assessment_id, student_id, score, graded_at)
        values (${ids.next()}, ${secondWorkId}, ${student.actor.studentId}, 88, '2026-11-01T09:00:00Z')`;
      await tx`update schedule_slots set course_id = ${courseId} where id = ${teacher.slotId}`;
    });
    return {
      teacher,
      student,
      otherStudent,
      courseId,
      courseTitle,
      workId,
      secondWorkId,
      workTitle,
      secondWorkTitle,
      key: attendance.key,
      path: `/teacher/grades/${teacher.slotId}/${attendance.key.occurrenceDate}`,
      entryKey: teacherGradeEntryKey(workId, student.actor.studentId),
      secondEntryKey: teacherGradeEntryKey(
        secondWorkId,
        student.actor.studentId,
      ),
      async close() {
        try {
          await sql.begin(async (tx) => {
            await tx`delete from login_attempts where key = ${`grades:teacher:${teacher.actor.teacherId}`}`;
            await tx`update schedule_slots set course_id = ${slot.courseId} where id = ${teacher.slotId}`;
            await tx`delete from scores where assessment_id in (${workId}, ${secondWorkId})`;
            await tx`delete from assessments where course_id = ${courseId}`;
            await tx`delete from courses where id = ${courseId}`;
          });
        } finally {
          await attendance.close();
        }
      },
    };
  } catch (error) {
    try {
      await sql.begin(async (tx) => {
        await tx`update schedule_slots set course_id = ${slot.courseId} where id = ${teacher.slotId}`;
        await tx`delete from scores where assessment_id in (${workId}, ${secondWorkId})`;
        await tx`delete from assessments where course_id = ${courseId}`;
        await tx`delete from courses where id = ${courseId}`;
      });
    } finally {
      await attendance.close();
    }
    throw error;
  }
}

export type TeacherGradesTestData = Awaited<
  ReturnType<typeof openTeacherGradesTestData>
>;
