import {
  assertPickupStaffChange,
  pickupDayBounds,
} from "@/domain/requests/pickup";
import { moscowDate } from "@/domain/schedule/dates";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { UnitOfWork } from "../ports/unit-of-work";
import { pickupBookingDto, requirePickup } from "../requests/pickup";
import type { PickupRepository } from "../requests/pickup-ports";
import { parsePickupStaffChange } from "../requests/schemas";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { ChangeStaffRequestStatus } from "./change-status";
import type { StaffTransaction } from "./ports";

export class ListStaffPickup {
  constructor(
    private readonly pickup: PickupRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const now = this.clock.now();
    const { from, to } = pickupDayBounds(moscowDate(now));
    return (await this.pickup.listForFaculties(actor.facultyIds, from, to)).map(
      (booking) => pickupBookingDto(booking, now),
    );
  }
}

export class ChangeStaffPickup {
  constructor(
    private readonly uow: UnitOfWork<StaffTransaction>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const data = parsePickupStaffChange(input);
    const action = `pickup_${data.to}`;
    const result = await this.uow.run(async (tx) => {
      const pickup = requirePickup(tx);
      const initial = await pickup.findByIdForFaculties(
        data.id,
        actor.facultyIds,
      );
      if (!initial) throw new NotFoundError();
      // All status paths lock the request before its booking.
      const request = await tx.requests.findByIdForFaculties(
        initial.requestId,
        actor.facultyIds,
        true,
      );
      if (!request) throw new NotFoundError();
      const booking = await pickup.findByIdForFaculties(
        data.id,
        actor.facultyIds,
        true,
      );
      if (!booking) throw new NotFoundError();
      const now = this.clock.now();
      if (data.to !== "served" && request.status !== "ready")
        throw new ConflictError();
      assertPickupStaffChange(
        booking.status,
        data.to,
        booking.slotStartsAt,
        now,
      );
      if (data.to === "served") {
        const change = new ChangeStaffRequestStatus(
          { run: (work) => work(tx) },
          this.clock,
          this.ids,
          this.logger,
        );
        await change.execute(actor, { id: request.id, to: "issued" });
      } else {
        await pickup.setStatus(booking.id, data.to, booking.status);
        await tx.audit.record({
          userId: actor.userId,
          action,
          entityId: request.id,
          occurredAt: now.toISOString(),
        });
        if (request.studentUserId)
          await tx.notifications.add({
            id: this.ids.next(),
            userId: request.studentUserId,
            requestId: request.id,
            title:
              data.to === "called"
                ? `Вас вызывают в ${booking.windowTitle.toLocaleLowerCase("ru-RU")}`
                : `Талон ${booking.ticketNo}: вы не пришли`,
            body:
              data.to === "called"
                ? `Подойдите в ${booking.windowTitle.toLocaleLowerCase("ru-RU")} с талоном ${booking.ticketNo}.`
                : "Выберите новое время получения справки в трекере заявки.",
            at: now.toISOString(),
          });
      }
      return { requestId: request.id };
    });
    this.logger.info(action, { user_id: actor.userId });
    return result;
  }
}
