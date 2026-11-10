import type { Clock } from "@/application/ports/clock";
import type { TeacherGradebookUnitOfWork } from "@/application/teacher/gradebook-ports";
import { canGradeReplacement } from "@/domain/grades/score-change";
import { moscowDate } from "@/domain/schedule/dates";
import type { TeacherPushAccess, TeacherPushRecipient } from "./push-ports";

export class TeacherGradePushAccess implements TeacherPushAccess {
  constructor(
    private readonly uow: TeacherGradebookUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async canNotifyStudent(teacherId: string, recipient: TeacherPushRecipient) {
    return this.uow.read(async (ctx) => {
      const key = {
        slotId: recipient.slotId,
        occurrenceDate: recipient.occurrenceDate,
      };
      const lesson = await ctx.teacherSchedule.findLessonForTeacher(
        key,
        teacherId,
      );
      if (!lesson) return false;
      if (
        !(await ctx.books.isBaseTeacherForLesson(key, teacherId)) &&
        !canGradeReplacement(lesson.date, moscowDate(this.clock.now()))
      )
        return false;
      const entry = await ctx.books.readEntryForTeacherLesson(
        key,
        teacherId,
        recipient.entryKey,
      );
      return entry !== null && entry.studentUserId === recipient.userId;
    });
  }
}
