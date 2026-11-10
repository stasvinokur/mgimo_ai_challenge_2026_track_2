import type { AttendanceStatus } from "@/domain/attendance/attendance";
import type { EventLesson } from "@/domain/requests/event-release";
import { eventLessons } from "@/domain/requests/event-release";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { ScheduleRepository } from "../schedule/ports";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { parseEventPreview } from "./schemas";

export async function calculateEventLessons(
  schedule: ScheduleRepository,
  studentId: string,
  payload: Record<string, unknown>,
  now: Date,
) {
  const dates = parseEventPreview(
    { dateFrom: payload.dateFrom, dateTo: payload.dateTo },
    now,
  );
  const data = await schedule.findForStudent(studentId);
  if (!data) throw new NotFoundError();
  return eventLessons(data, dates.dateFrom, dates.dateTo);
}

export class PreviewEventRelease {
  constructor(
    private readonly schedule: ScheduleRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const now = this.clock.now();
    const dates = parseEventPreview(input, now);
    return calculateEventLessons(this.schedule, actor.studentId, dates, now);
  }
}

export interface EventReleaseReview {
  past: boolean;
  changed: boolean;
  lessons: (EventLesson & { attendanceStatus: AttendanceStatus | null })[];
}
