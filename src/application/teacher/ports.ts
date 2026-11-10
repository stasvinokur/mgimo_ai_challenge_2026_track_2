import type { LessonKey } from "@/domain/attendance/attendance";
import type { Lesson } from "@/domain/schedule/schedule";

export interface TeacherLesson extends Lesson {
  group: string;
}

export interface TeacherScheduleRepository {
  listForTeacher(
    teacherId: string,
    from: string,
    to: string,
  ): Promise<TeacherLesson[]>;
  findLessonForTeacher(
    key: LessonKey,
    teacherId: string,
  ): Promise<TeacherLesson | null>;
}
