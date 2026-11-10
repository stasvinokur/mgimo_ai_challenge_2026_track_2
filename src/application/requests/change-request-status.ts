import {
  EVENT_ACTIVITY_POINTS,
  EVENT_RELEASE_TYPE,
} from "@/domain/requests/event-release";
import {
  type RequestStatus,
  transitionRequest,
} from "@/domain/requests/request-flow";
import { addWorkDays } from "@/domain/requests/sla-policy";
import { staffCommentLabel } from "@/domain/requests/staff-comments";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { UnitOfWork } from "../ports/unit-of-work";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { requestDto, requestLabels } from "./dto";
import { calculateEventLessons } from "./event-release";
import { enforceRequestLimit, submissionWindowStart } from "./limits";
import type { RequestRecord, RequestTransaction } from "./ports";
import {
  checkRequestPayload,
  parseRequestId,
  parseStatusChange,
  savedEventLessons,
} from "./schemas";
import type { RequestSubmissionLimit } from "./submission-limit";

export class ChangeRequestStatus {
  constructor(
    private readonly uow: UnitOfWork<RequestTransaction>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly submissionLimit?: RequestSubmissionLimit,
    private readonly expectedDraft?: Pick<
      RequestRecord,
      "updatedAt" | "payload"
    >,
  ) {}
  async execute(actor: Actor, input: unknown, ip?: string) {
    if (actor.kind !== "student" && actor.kind !== "staff")
      throw new ForbiddenError();
    const data = parseStatusChange(input);
    const reservation =
      actor.kind === "student" && data.to === "submitted"
        ? await this.submissionLimit?.reserve(actor, ip, data.id)
        : null;
    try {
      const result = await this.change(actor, data, Boolean(reservation));
      await reservation?.commitFailure();
      return result;
    } catch (error) {
      await reservation?.release();
      throw error;
    }
  }

  private async change(
    actor: Exclude<Actor, { kind: "teacher" }>,
    data: ReturnType<typeof parseStatusChange>,
    demoSubmission: boolean,
  ) {
    return this.uow.run(async (tx) => {
      const record =
        actor.kind === "student"
          ? await tx.requests.findByIdForStudent(data.id, actor.studentId, true)
          : await tx.requests.findByIdForFaculties(
              data.id,
              actor.facultyIds,
              true,
            );
      if (!record) throw new NotFoundError();
      let comment = data.comment;
      if (
        actor.kind === "staff" &&
        (await tx.requests.isDemoAccount(actor.userId))
      ) {
        const label = data.commentCode
          ? staffCommentLabel(data.to, data.commentCode)
          : null;
        if (data.comment !== undefined || (data.commentCode && !label))
          throw new ValidationError({
            comment: ["Выберите комментарий из списка."],
          });
        comment = label ?? undefined;
      }
      const expected = this.expectedDraft;
      if (
        expected &&
        (record.status !== "draft" ||
          record.updatedAt !== expected.updatedAt ||
          Object.keys(record.payload).length !==
            Object.keys(expected.payload).length ||
          Object.entries(record.payload).some(
            ([key, value]) => value !== expected.payload[key],
          ))
      )
        throw new ConflictError();
      if (actor.kind === "student" && data.to === "ready")
        throw new ForbiddenError();
      const now = this.clock.now();
      const type = await tx.requests.findType(record.typeCode);
      if (!type) throw new NotFoundError();
      const submitting = data.to === "submitted";
      const validation = submitting
        ? checkRequestPayload(type.fieldsSchema, record.payload, false, now)
        : null;
      if (validation && !validation.success)
        throw new ValidationError(validation.fieldErrors);
      const result = transitionRequest({
        from: record.status,
        to: data.to,
        role: actor.kind,
        comment,
        payloadValid: validation?.success,
      });
      const at = now.toISOString();
      const next = {
        ...record,
        status: result.status as RequestStatus,
        updatedAt: at,
      };
      const eventRequest = type.code === EVENT_RELEASE_TYPE;
      let approvedCount: number | undefined;
      if (eventRequest && (submitting || data.to === "ready")) {
        const eventRelease = tx.eventRelease;
        if (!eventRelease)
          throw new ValidationError({
            typeCode: ["Освобождение временно недоступно. Повторите позже."],
          });
        const payload =
          validation ??
          checkRequestPayload(type.fieldsSchema, record.payload, false, now);
        if (!payload.success) throw new ValidationError(payload.fieldErrors);
        const lessons = await calculateEventLessons(
          eventRelease.schedule,
          record.studentId,
          payload.payload,
          now,
        );
        next.payload = {
          ...payload.payload,
          eventLessons: lessons,
          submittedEventLessons: submitting
            ? lessons
            : savedEventLessons({
                eventLessons:
                  record.payload.submittedEventLessons ??
                  record.payload.eventLessons,
              }),
        };
        if (data.to === "ready") {
          const sourceKey = `event:${record.id}`;
          // Attendance and status share the transaction, including failure rollback.
          for (const lesson of lessons)
            await eventRelease.attendance.markExcusedForStudent(
              record.studentId,
              lesson,
              {
                sourceKey,
                reason: payload.payload.eventName ?? "",
                markedAt: at,
              },
            );
          await eventRelease.attendance.awardActivityForStudent(
            record.studentId,
            {
              sourceKey,
              points: EVENT_ACTIVITY_POINTS,
              createdAt: at,
            },
          );
          approvedCount = lessons.length;
        }
      }
      if (submitting) {
        const usage = await tx.requests.lockUsageForStudent(
          record.studentId,
          submissionWindowStart(now),
        );
        if (!demoSubmission)
          enforceRequestLimit(usage.submissions, "submissions");
        const year = new Date(now.getTime() + 3 * 3_600_000).getUTCFullYear();
        next.publicNo = await tx.requests.nextPublicNo(year);
        next.submittedAt = at;
        next.dueAt = addWorkDays(now, type.slaWorkDays).toISOString();
      }
      const pickup = next.status === "issued" ? tx.pickup : null;
      if (next.status === "issued" && !pickup)
        throw new ValidationError({
          pickup: ["Выдача временно недоступна. Повторите позже."],
        });
      await tx.requests.save(
        next,
        record,
        actor.kind === "staff" ? actor.staffId : undefined,
      );
      if (pickup) await pickup.serveForRequest(record.id);
      await tx.requests.appendEvent({
        id: this.ids.next(),
        requestId: record.id,
        fromStatus: record.status,
        toStatus: next.status,
        actorUserId: actor.userId,
        comment: result.event.comment,
        at,
      });
      if (record.studentUserId)
        await tx.notifications.add({
          id: this.ids.next(),
          userId: record.studentUserId,
          requestId: record.id,
          title:
            approvedCount === undefined
              ? `${next.publicNo} — ${requestLabels[next.status]}`
              : `Освобождение одобрено: ${approvedCount} пар — уважительная причина`,
          body:
            result.event.comment ??
            `Статус заявки «${type.title}»: ${requestLabels[next.status]}.`,
          at,
        });
      if (next.status === "ready" && type.isCertificate)
        await tx.certificates.create({
          id: this.ids.next(),
          requestId: record.id,
          publicNo: next.publicNo,
          at,
        });
      return requestDto(next, type, now);
    });
  }
}

export class SubmitRequest {
  constructor(private readonly change: ChangeRequestStatus) {}
  async execute(actor: Actor, input: { id: string }, ip?: string) {
    if (actor.kind !== "student") throw new ForbiddenError();
    return this.change.execute(
      actor,
      {
        id: parseRequestId(input.id),
        to: "submitted",
      },
      ip,
    );
  }
}
