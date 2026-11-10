import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { requestDto, typeDto } from "./dto";
import type { RequestRepository } from "./ports";
import {
  parseCreateDraft,
  parseRequestId,
  validateRequestPayload,
} from "./schemas";

export class GetRequestCatalog {
  constructor(private readonly requests: RequestRepository) {}
  async execute(actor: Actor) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const profile = await this.requests.findProfileForStudent(actor.studentId);
    if (!profile) throw new NotFoundError();
    return { types: (await this.requests.listTypes()).map(typeDto), profile };
  }
}
export class ListMyRequests {
  constructor(
    private readonly requests: RequestRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const types = await this.requests.listTypes();
    return (await this.requests.listForStudent(actor.studentId)).map(
      (record) => {
        const type = types.find((type) => type.code === record.typeCode);
        if (!type) throw new NotFoundError();
        return requestDto(record, type, this.clock.now());
      },
    );
  }
}
export class GetMyRequest {
  constructor(
    private readonly requests: RequestRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: { id: string }) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const id = parseRequestId(input.id);
    const record = await this.requests.findByIdForStudent(id, actor.studentId);
    if (!record) throw new NotFoundError();
    const type = await this.requests.findType(record.typeCode);
    if (!type) throw new NotFoundError();
    return {
      ...requestDto(record, type, this.clock.now()),
      events: (
        await this.requests.listEventsForStudent(id, actor.studentId)
      ).map(({ actorUserId: _actor, requestId: _request, ...event }) => event),
    };
  }
}
export type RequestDetailDto = Awaited<ReturnType<GetMyRequest["execute"]>>;

export class CheckRequestPayload {
  constructor(
    private readonly requests: RequestRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const data = parseCreateDraft(input);
    const type = await this.requests.findType(data.typeCode);
    if (!type) throw new NotFoundError();
    return validateRequestPayload(
      type.fieldsSchema,
      data.payload,
      false,
      this.clock.now(),
    );
  }
}
