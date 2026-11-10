import { addDays, moscowDate, weekStart } from "@/domain/schedule/dates";
import { daySummary } from "@/domain/schedule/schedule";
import type { AttendanceRecords } from "../attendance/ports";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import { ForbiddenError } from "../shared/errors";
import type { TeacherScheduleRepository } from "./ports";

export class GetMyLessons {
  constructor(
    private readonly repository: TeacherScheduleRepository,
    private readonly clock: Clock,
    private readonly attendance: Pick<
      AttendanceRecords,
      "listForTeacherLesson"
    >,
  ) {}

  async execute(actor: Actor) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const now = this.clock.now();
    const today = moscowDate(now);
    const start = weekStart(today);
    const schedule = await this.repository.listForTeacher(
      actor.teacherId,
      start,
      addDays(start, 6),
    );
    const records = new Map<
      string,
      ReturnType<AttendanceRecords["listForTeacherLesson"]>
    >();
    const lessons = await Promise.all(
      schedule.map(async (lesson) => {
        let own = records.get(lesson.id);
        if (!own) {
          own = this.attendance.listForTeacherLesson(
            {
              slotId: lesson.id.slice(0, -11),
              occurrenceDate: lesson.id.slice(-10),
            },
            actor.teacherId,
          );
          records.set(lesson.id, own);
        }
        return { ...lesson, attendance: await own };
      }),
    );
    const todayLessons = lessons.filter((lesson) => lesson.date === today);
    return {
      today,
      now: now.toISOString(),
      todayLessons,
      summary: daySummary(lessons, today, now),
      days: Array.from({ length: 7 }, (_, index) => {
        const date = addDays(start, index);
        return {
          date,
          lessons: lessons.filter((lesson) => lesson.date === date),
        };
      }),
    };
  }
}
