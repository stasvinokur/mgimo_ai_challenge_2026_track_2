import type { AttendanceRecords } from "@/application/attendance/ports";
import type {
  TeacherLesson,
  TeacherScheduleRepository,
} from "@/application/teacher/ports";
import type { LessonKey } from "@/domain/attendance/attendance";

export const oleg = {
  kind: "teacher",
  userId: "oleg-user",
  teacherId: "oleg-teacher",
} as const;

export class FakeTeacherScheduleRepository
  implements TeacherScheduleRepository
{
  calls: string[] = [];
  lessons = new Map<string, TeacherLesson[]>();
  async listForTeacher(teacherId: string, from: string, to: string) {
    this.calls.push(teacherId);
    return structuredClone(
      (this.lessons.get(teacherId) ?? []).filter(
        (lesson) => lesson.date >= from && lesson.date <= to,
      ),
    );
  }
  async findLessonForTeacher(key: LessonKey, teacherId: string) {
    return (
      this.lessons
        .get(teacherId)
        ?.find(
          (lesson) => lesson.id === `${key.slotId}:${key.occurrenceDate}`,
        ) ?? null
    );
  }
}

export class FakeTeacherAttendanceRecords
  implements Pick<AttendanceRecords, "listForTeacherLesson">
{
  calls: { lesson: LessonKey; teacherId: string }[] = [];
  async listForTeacherLesson(lesson: LessonKey, teacherId: string) {
    this.calls.push({ lesson, teacherId });
    return [
      {
        fullName: "Учебный студент",
        group: "ДЕМО-1",
        status: "present" as const,
      },
    ];
  }
}
