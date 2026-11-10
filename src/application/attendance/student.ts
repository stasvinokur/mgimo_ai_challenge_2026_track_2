import type { LessonKey } from "@/domain/attendance/attendance";
import {
  ACTIVITY_GOAL,
  attendanceTotals,
  attendanceWindowOpen,
  lessonSourceKey,
  PRESENT_POINTS,
} from "@/domain/attendance/policy";
import { buildSchedule, isActive } from "@/domain/schedule/schedule";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { RateLimiter } from "../ports/rate-limiter";
import { ForbiddenError } from "../shared/errors";
import type { AttendanceRecords } from "./ports";
import type {
  AttendanceContext,
  AttendanceCourses,
  AttendanceTokens,
  AttendanceUnitOfWork,
} from "./qr-ports";
import { reserveAttendanceLimit } from "./rate-limit";
import {
  parseAttendanceIp,
  parseAttendanceQuery,
  parseConfirmation,
  parseMark,
} from "./schemas";

export const INVALID_CODE = "invalidCode" as const;
export type Confirmation =
  | { valid: false; messageCode: typeof INVALID_CODE }
  | { valid: true; course: string; alreadyPresent: boolean };
export type MarkResult =
  | { result: "invalid"; messageCode: typeof INVALID_CODE }
  | { result: "already"; messageCode: "alreadyPresent" }
  | { result: "marked"; messageCode: "marked"; points: number };

export type AttendActionState =
  | MarkResult
  | {
      result: "error";
      messageCode: "forbidden" | "rateLimited" | "invalidForm" | "failed";
    }
  | null;

async function resolve(
  ctx: AttendanceContext,
  tokens: AttendanceTokens,
  code: string,
  studentId: string,
  now: Date,
) {
  const saved = await ctx.codes.findActive(
    tokens.hash(code),
    now.toISOString(),
  );
  if (!saved) return null;
  const teacherLesson = await ctx.teacherSchedule.findLessonForTeacher(
    saved,
    saved.teacherId,
  );
  if (!teacherLesson || !attendanceWindowOpen(teacherLesson, now)) return null;
  const schedule = await ctx.schedule.findForStudent(studentId);
  if (!schedule) return null;
  const lesson = buildSchedule(
    schedule,
    teacherLesson.date,
    teacherLesson.date,
  ).find(
    (lesson) =>
      lesson.id === `${saved.slotId}:${saved.occurrenceDate}` &&
      isActive(lesson),
  );
  if (!lesson || !attendanceWindowOpen(lesson, now)) return null;
  return { saved, lesson };
}

export class GetAttendanceConfirmation {
  constructor(
    private readonly uow: AttendanceUnitOfWork,
    private readonly tokens: AttendanceTokens,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown): Promise<Confirmation> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const parsed = parseConfirmation(input);
    if (!parsed.success) return { valid: false, messageCode: INVALID_CODE };
    return this.uow.run(async (ctx) => {
      const found = await resolve(
        ctx,
        this.tokens,
        parsed.data.code,
        actor.studentId,
        this.clock.now(),
      );
      if (!found) return { valid: false, messageCode: INVALID_CODE };
      const data = await ctx.records.listForStudent(
        actor.studentId,
        found.saved.occurrenceDate,
        found.saved.occurrenceDate,
      );
      return {
        valid: true,
        course: found.lesson.course,
        alreadyPresent: data.records.some(
          (row) =>
            row.slotId === found.saved.slotId && row.status === "present",
        ),
      };
    });
  }
}

export class MarkAttendance {
  constructor(
    private readonly uow: AttendanceUnitOfWork,
    private readonly tokens: AttendanceTokens,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
  ) {}
  async execute(actor: Actor, input: unknown): Promise<MarkResult> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const ip = parseAttendanceIp(input);
    await reserveAttendanceLimit(
      this.limiter,
      "mark",
      actor.userId,
      ip,
      this.tokens,
    );
    const parsed = parseMark(input);
    const invalid: MarkResult = {
      result: "invalid",
      messageCode: INVALID_CODE,
    };
    if (!parsed.success) return invalid;
    return this.uow.run(async (ctx) => {
      const initial = await ctx.codes.findActive(
        this.tokens.hash(parsed.data.code),
        this.clock.now().toISOString(),
      );
      if (!initial) return invalid;
      await ctx.lockLesson(initial);
      // Re-read after the lock: close/expiry/replacement must beat a queued mark.
      const now = this.clock.now();
      const found = await resolve(
        ctx,
        this.tokens,
        parsed.data.code,
        actor.studentId,
        now,
      );
      if (!found) return invalid;
      const key: LessonKey = found.saved;
      const data = await ctx.records.listForStudent(
        actor.studentId,
        key.occurrenceDate,
        key.occurrenceDate,
      );
      if (
        data.records.some(
          (row) => row.slotId === key.slotId && row.status === "present",
        )
      )
        return { result: "already", messageCode: "alreadyPresent" };
      const sourceKey = lessonSourceKey(key);
      await ctx.records.markPresentForStudent(actor.studentId, key, {
        sourceKey,
        markedAt: now.toISOString(),
      });
      await ctx.records.awardActivityForStudent(actor.studentId, {
        sourceKey,
        points: PRESENT_POINTS,
        createdAt: now.toISOString(),
      });
      return {
        result: "marked",
        messageCode: "marked",
        points: PRESENT_POINTS,
      };
    });
  }
}

export class GetMyAttendance {
  constructor(
    private readonly records: AttendanceRecords,
    private readonly courses: AttendanceCourses,
  ) {}
  async execute(actor: Actor, input: unknown = {}) {
    if (actor.kind !== "student") throw new ForbiddenError();
    parseAttendanceQuery(input);
    const [data, slots] = await Promise.all([
      this.records.listForStudent(actor.studentId, "0001-01-01", "9999-12-31"),
      this.courses.listForStudent(actor.studentId),
    ]);
    const courses = [
      ...new Map(
        slots.map((slot) => [
          slot.courseId,
          { id: slot.courseId, title: slot.title },
        ]),
      ).values(),
    ].map((course) => {
      const ids = new Set(
        slots
          .filter((slot) => slot.courseId === course.id)
          .map((slot) => slot.slotId),
      );
      return {
        ...course,
        ...attendanceTotals(
          data.records
            .filter((row) => ids.has(row.slotId))
            .map((row) => row.status),
        ),
      };
    });
    return {
      courses,
      activityPoints: data.activityPoints,
      goal: ACTIVITY_GOAL,
    };
  }
}
