import type { LessonKey } from "@/domain/attendance/attendance";
import {
  attendanceWindowOpen,
  canCloseAttendance,
  codeTiming,
} from "@/domain/attendance/policy";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { RateLimiter } from "../ports/rate-limiter";
import { absoluteAppUrl } from "../shared/app-path.mjs";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import type { GetMyLessons } from "../teacher/get-my-lessons";
import type {
  AttendanceContext,
  AttendanceQrEncoder,
  AttendanceTokens,
  AttendanceUnitOfWork,
} from "./qr-ports";
import { reserveAttendanceLimit } from "./rate-limit";
import { parseClose, parseIssue, parseLesson } from "./schemas";

async function ownLesson(
  ctx: AttendanceContext,
  key: LessonKey,
  teacherId: string,
) {
  const lesson = await ctx.teacherSchedule.findLessonForTeacher(key, teacherId);
  if (!lesson) throw new NotFoundError();
  return lesson;
}

export class GetTeacherAttendance {
  constructor(
    private readonly uow: AttendanceUnitOfWork,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const key = parseLesson(input);
    return this.uow.run(async (ctx) => {
      const lesson = await ownLesson(ctx, key, actor.teacherId);
      const roster = await ctx.records.listRosterForTeacherLesson(
        key,
        actor.teacherId,
      );
      return {
        lesson,
        roster,
        windowOpen: attendanceWindowOpen(lesson, this.clock.now()),
        canClose: canCloseAttendance(lesson, this.clock.now()),
        present: roster.filter((row) => row.status === "present").length,
        total: roster.length,
      };
    });
  }
}

export class IssueAttendanceCode {
  constructor(
    private readonly uow: AttendanceUnitOfWork,
    private readonly clock: Clock,
    private readonly tokens: AttendanceTokens,
    private readonly qr: AttendanceQrEncoder,
    private readonly limiter: RateLimiter,
    private readonly origin: () => string | Promise<string>,
    private readonly basePath: () => string = () => "",
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const { lesson: key, previousCode, ip } = parseIssue(input);
    await reserveAttendanceLimit(
      this.limiter,
      "issue",
      actor.userId,
      ip,
      this.tokens,
    );
    const issued = await this.uow.run(async (ctx) => {
      await ctx.lockLesson(key);
      const lesson = await ownLesson(ctx, key, actor.teacherId);
      const now = this.clock.now();
      if (!attendanceWindowOpen(lesson, now)) throw new ConflictError();
      if (previousCode) {
        const previous = await ctx.codes.findActive(
          this.tokens.hash(previousCode),
          now.toISOString(),
        );
        if (
          !previous ||
          previous.slotId !== key.slotId ||
          previous.occurrenceDate !== key.occurrenceDate ||
          previous.teacherId !== actor.teacherId
        )
          throw new ConflictError();
      }
      const code = this.tokens.generate();
      const timing = codeTiming(now, lesson);
      await ctx.codes.issue({
        ...key,
        teacherId: actor.teacherId,
        codeHash: this.tokens.hash(code),
        createdAt: now.toISOString(),
        expiresAt: timing.expiresAt,
      });
      return { path: `/attend/${code}`, ...timing };
    });
    const url = absoluteAppUrl(
      await this.origin(),
      issued.path,
      this.basePath(),
    );
    return { ...issued, url, qrImage: await this.qr.encode(url) };
  }
}

export class CloseTeacherAttendance {
  constructor(
    private readonly uow: AttendanceUnitOfWork,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
    private readonly tokens: Pick<AttendanceTokens, "hash">,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const { ip, ...key } = parseClose(input);
    await reserveAttendanceLimit(
      this.limiter,
      "close",
      actor.userId,
      ip,
      this.tokens,
    );
    await this.uow.run(async (ctx) => {
      await ctx.lockLesson(key);
      const lesson = await ownLesson(ctx, key, actor.teacherId);
      if (!canCloseAttendance(lesson, this.clock.now()))
        throw new ConflictError();
      await ctx.codes.revokeForLesson(key);
      await ctx.records.closeForTeacherLesson(
        key,
        actor.teacherId,
        this.clock.now().toISOString(),
      );
    });
    return { closed: true as const };
  }
}

export class GetAttendanceLessons {
  constructor(
    private readonly lessons: Pick<GetMyLessons, "execute">,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const data = await this.lessons.execute(actor);
    const enhance = (lesson: (typeof data.todayLessons)[number]) => ({
      ...lesson,
      attendanceOpen: attendanceWindowOpen(lesson, this.clock.now()),
    });
    return {
      ...data,
      todayLessons: data.todayLessons.map(enhance),
      days: data.days.map((day) => ({
        ...day,
        lessons: day.lessons.map(enhance),
      })),
    };
  }
}
