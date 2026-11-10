import { transitionRequest } from "@/domain/requests/request-flow";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { UnitOfWork } from "../ports/unit-of-work";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import type { RequestDraftLimit } from "./draft-limit";
import {
  enforceRequestLimit,
  OPEN_DRAFT_LIMIT,
  submissionWindowStart,
} from "./limits";
import type { RequestTransaction } from "./ports";
import {
  parseCreateDraft,
  parseRequestId,
  parseUpdateDraft,
  validateRequestPayload,
} from "./schemas";

class RetryDraftEviction extends Error {}

export class CreateRequestDraft {
  constructor(
    private readonly uow: UnitOfWork<RequestTransaction>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly draftLimit?: RequestDraftLimit,
  ) {}
  async execute(actor: Actor, input: unknown, ip?: string) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const data = parseCreateDraft(input);
    const reservation = await this.draftLimit?.reserve(actor, ip);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await this.create(actor, data);
          await reservation?.commitFailure();
          return result;
        } catch (error) {
          if (!(error instanceof RetryDraftEviction)) throw error;
        }
      }
      throw new ConflictError();
    } catch (error) {
      await reservation?.release();
      throw error;
    }
  }

  private async create(
    actor: Extract<Actor, { kind: "student" }>,
    data: ReturnType<typeof parseCreateDraft>,
  ) {
    return this.uow.run(async ({ requests }) => {
      const type = await requests.findType(data.typeCode);
      if (!type) throw new NotFoundError();
      const payload = validateRequestPayload(
        type.fieldsSchema,
        data.payload,
        true,
        this.clock.now(),
      );
      const now = this.clock.now();
      const demo = await requests.isDemoAccount(actor.userId);
      // Match submission's request-before-owner lock order before evicting a draft.
      const oldest = demo
        ? await requests.findOldestUnseededDraftForStudent(
            actor.studentId,
            true,
          )
        : null;
      const usage = await requests.lockUsageForStudent(
        actor.studentId,
        submissionWindowStart(now),
      );
      if (usage.openDrafts >= OPEN_DRAFT_LIMIT && demo) {
        if (!oldest) {
          // A concurrent creator may have filled an initially empty queue.
          if (await requests.findOldestUnseededDraftForStudent(actor.studentId))
            throw new RetryDraftEviction();
          enforceRequestLimit(usage.openDrafts, "drafts");
        } else {
          transitionRequest({
            from: oldest.status,
            to: "deleted",
            role: "student",
          });
          await requests.deleteDraftForStudent(oldest.id, actor.studentId);
        }
      } else enforceRequestLimit(usage.openDrafts, "drafts");
      const id = this.ids.next();
      const at = now.toISOString();
      await requests.createDraft({
        id,
        publicNo: `draft:${id}`,
        studentId: actor.studentId,
        studentUserId: actor.userId,
        facultyId: actor.facultyId,
        typeCode: type.code,
        payload,
        status: "draft",
        assignee: null,
        submittedAt: null,
        dueAt: null,
        createdAt: at,
        updatedAt: at,
      });
      return { id };
    });
  }
}
export class UpdateRequestDraft {
  constructor(
    private readonly uow: UnitOfWork<RequestTransaction>,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const data = parseUpdateDraft(input);
    return this.uow.run(async ({ requests }) => {
      const record = await requests.findByIdForStudent(
        data.id,
        actor.studentId,
        true,
      );
      if (!record) throw new NotFoundError();
      if (record.status !== "draft") throw new ConflictError();
      const type = await requests.findType(record.typeCode);
      if (!type) throw new NotFoundError();
      const payload = validateRequestPayload(
        type.fieldsSchema,
        data.payload,
        true,
        this.clock.now(),
      );
      await requests.save(
        { ...record, payload, updatedAt: this.clock.now().toISOString() },
        record,
      );
      return { id: record.id };
    });
  }
}
export class DeleteRequestDraft {
  constructor(private readonly uow: UnitOfWork<RequestTransaction>) {}
  async execute(actor: Actor, input: { id: string }) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const id = parseRequestId(input.id);
    await this.uow.run(async ({ requests }) => {
      const record = await requests.findByIdForStudent(
        id,
        actor.studentId,
        true,
      );
      if (!record) throw new NotFoundError();
      transitionRequest({
        from: record.status,
        to: "deleted",
        role: actor.kind,
      });
      await requests.deleteDraftForStudent(id, actor.studentId);
    });
  }
}
