import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { UnitOfWork } from "../ports/unit-of-work";
import { ChangeRequestStatus } from "../requests/change-request-status";
import { ForbiddenError } from "../shared/errors";
import { staffActions } from "./dto";
import type { StaffTransaction } from "./ports";
import { parseStaffChange } from "./schemas";

export class ChangeStaffRequestStatus {
  constructor(
    private readonly uow: UnitOfWork<StaffTransaction>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const data = parseStaffChange(input);
    const action = staffActions[data.to].code;
    const result = await this.uow.run(async (tx) => {
      // Reuse the locked transition without opening a second transaction.
      const change = new ChangeRequestStatus(
        { run: (work) => work(tx) },
        this.clock,
        this.ids,
      );
      const result = await change.execute(actor, data);
      await tx.audit.record({
        userId: actor.userId,
        action,
        entityId: result.id,
        occurredAt: result.updatedAt,
      });
      return { id: result.id };
    });
    this.logger.info(action, { user_id: actor.userId });
    return result;
  }
}
