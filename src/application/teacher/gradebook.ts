import type { LessonKey } from "@/domain/attendance/attendance";
import { canGradeReplacement, scoreChange } from "@/domain/grades/score-change";
import { moscowDate } from "@/domain/schedule/dates";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { RateLimiter, RateLimitReservation } from "../ports/rate-limiter";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "../shared/errors";
import type {
  GradebookReadContext,
  TeacherGradebookUnitOfWork,
} from "./gradebook-ports";
import { parseGradebookLesson, parseTeacherGrade } from "./schemas";

async function ownLesson(
  ctx: GradebookReadContext,
  key: LessonKey,
  teacherId: string,
  today: string,
) {
  const lesson = await ctx.teacherSchedule.findLessonForTeacher(key, teacherId);
  if (!lesson) throw new NotFoundError();
  if (
    !(await ctx.books.isBaseTeacherForLesson(key, teacherId)) &&
    !canGradeReplacement(lesson.date, today)
  )
    throw new NotFoundError();
  return lesson;
}

export class GradeScoreConflictError extends ConflictError {
  constructor() {
    super();
    this.message = "Балл уже изменили, обновите ведомость";
  }
}

export class GradeScoreRateLimitedError extends RateLimitedError {
  constructor() {
    super();
    this.message = "Слишком много изменений баллов. Попробуйте через 15 минут";
  }
}

export class ListTeacherGradebooks {
  constructor(
    private readonly uow: TeacherGradebookUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    return this.uow.read(async (ctx) => ({
      books: await ctx.books.listForTeacher(
        actor.teacherId,
        moscowDate(this.clock.now()),
      ),
    }));
  }
}

export class GetTeacherGradebook {
  constructor(
    private readonly uow: TeacherGradebookUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const key = parseGradebookLesson(input);
    return this.uow.read(async (ctx) => {
      const lesson = await ownLesson(
        ctx,
        key,
        actor.teacherId,
        moscowDate(this.clock.now()),
      );
      return {
        lesson,
        ...(await ctx.books.getForTeacherLesson(key, actor.teacherId)),
      };
    });
  }
}

export class SetTeacherGrade {
  constructor(
    private readonly uow: TeacherGradebookUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly limiter: RateLimiter,
  ) {}

  async execute(actor: Actor, input: unknown) {
    const result = await this.executeWithRecipient(actor, input);
    return { changed: result.changed, courseId: result.courseId };
  }

  async executeWithRecipient(actor: Actor, input: unknown) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    const { entryKey, score, expectedScore, reason, ...key } =
      parseTeacherGrade(input);
    const usage: { reservation: RateLimitReservation | null } = {
      reservation: null,
    };
    try {
      await this.uow.read(async (ctx) => {
        await ownLesson(
          ctx,
          key,
          actor.teacherId,
          moscowDate(this.clock.now()),
        );
        const entry = await ctx.books.readEntryForTeacherLesson(
          key,
          actor.teacherId,
          entryKey,
        );
        if (!entry) throw new NotFoundError();
        if (entry.score !== expectedScore) throw new GradeScoreConflictError();
        scoreChange({
          score,
          maxScore: entry.maxScore,
          previousScore: entry.score,
          ...(reason ? { reason } : {}),
        });
      });
      // Reserve between transactions so a single-connection pool can proceed.
      if (score !== expectedScore) {
        usage.reservation = await this.limiter.reserve([
          {
            key: `grades:teacher:${actor.teacherId}`,
            limit: 30,
            windowSec: 900,
          },
        ]);
        if (!usage.reservation) throw new GradeScoreRateLimitedError();
      }
      const result = await this.uow.run(async (ctx) => {
        // Reject foreign lessons before taking any advisory or row lock.
        await ownLesson(
          ctx,
          key,
          actor.teacherId,
          moscowDate(this.clock.now()),
        );
        // Lock an absent score too: two first submissions share one history.
        await ctx.lockEntry(entryKey);
        await ctx.lockLesson(key);
        await ownLesson(
          ctx,
          key,
          actor.teacherId,
          moscowDate(this.clock.now()),
        );
        const entry = await ctx.books.findEntryForTeacherLesson(
          key,
          actor.teacherId,
          entryKey,
        );
        if (!entry) throw new NotFoundError();
        if (entry.score !== expectedScore) throw new GradeScoreConflictError();
        const change = scoreChange({
          score,
          maxScore: entry.maxScore,
          previousScore: entry.score,
          ...(reason ? { reason } : {}),
        });
        if (change.changed) {
          await ctx.books.recordChange({
            entry,
            score,
            reason: change.reason,
            changedByUserId: actor.userId,
            at: this.clock.now().toISOString(),
            eventId: this.ids.next(),
            notificationId: this.ids.next(),
          });
        }
        return {
          changed: change.changed,
          courseId: entry.courseId,
          pushRecipient:
            change.changed && entry.studentUserId
              ? { userId: entry.studentUserId, ...key, entryKey }
              : null,
        };
      });
      // Keep quota only after the database transaction has committed.
      if (result.changed) await usage.reservation?.commitFailure();
      else await usage.reservation?.release();
      return result;
    } catch (error) {
      await usage.reservation?.release();
      throw error;
    }
  }
}

export type TeacherGradebookDto = Awaited<
  ReturnType<GetTeacherGradebook["execute"]>
>;
export type TeacherGradebookListDto = Awaited<
  ReturnType<ListTeacherGradebooks["execute"]>
>;
