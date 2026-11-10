import {
  assertPickupChange,
  assertPickupSlot,
  canChangePickup,
  isPickupExpired,
  pickupDayBounds,
  pickupDays,
  pickupEligible,
  pickupSlots,
} from "@/domain/requests/pickup";
import { moscowDate } from "@/domain/schedule/dates";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { RateLimiter } from "../ports/rate-limiter";
import type { UnitOfWork } from "../ports/unit-of-work";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { reservePickupChange } from "./pickup-limits";
import type { PickupBookingRecord, PickupRepository } from "./pickup-ports";
import type { RequestRepository, RequestTransaction } from "./ports";
import { parsePickupBooking, parsePickupId, parseRequestId } from "./schemas";

export function pickupBookingDto(record: PickupBookingRecord, now: Date) {
  // Reads expose expiry; the next booking persists no_show atomically.
  return {
    id: record.id,
    requestId: record.requestId,
    windowId: record.windowId,
    windowTitle: record.windowTitle,
    slotStartsAt: record.slotStartsAt,
    ticketNo: record.ticketNo,
    status: isPickupExpired(record.status, record.slotStartsAt, now)
      ? "no_show"
      : record.status,
    canCancel: canChangePickup(record.status, record.slotStartsAt, now),
  };
}
export type PickupBookingDto = ReturnType<typeof pickupBookingDto>;
export interface PickupStateDto {
  eligible: boolean;
  booking: PickupBookingDto | null;
  windows: { id: string; title: string; slots: string[] }[];
}

export function requirePickup(tx: RequestTransaction): PickupRepository {
  if (!tx.pickup)
    throw new ValidationError({
      pickup: ["pickupUnavailable"],
    });
  return tx.pickup;
}

export class GetRequestPickup {
  constructor(
    private readonly requests: RequestRepository,
    private readonly pickup: PickupRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: { id: string }): Promise<PickupStateDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const request = await this.requests.findByIdForStudent(
      parseRequestId(input.id),
      actor.studentId,
    );
    if (!request) throw new NotFoundError();
    const type = await this.requests.findType(request.typeCode);
    if (!type) throw new NotFoundError();
    if (!pickupEligible(request.status, type.delivery, type.isCertificate))
      return { eligible: false, booking: null, windows: [] };
    const now = this.clock.now();
    const booking = await this.pickup.findActiveForRequestForStudent(
      request.id,
      actor.studentId,
    );
    const days = pickupDays(now);
    const first = days[0];
    const last = days.at(-1);
    if (!first || !last) throw new NotFoundError();
    const windows = await this.pickup.listWindowsForFaculty(request.facultyId);
    const choices = await Promise.all(
      windows.map(async (window) => {
        const occupied = new Set(
          await this.pickup.listOccupiedSlots(
            window.id,
            pickupDayBounds(first).from,
            pickupDayBounds(last).to,
          ),
        );
        return {
          id: window.id,
          title: window.title,
          slots: days
            .flatMap((day) => pickupSlots(day, now, window))
            .filter((slot) => !occupied.has(slot)),
        };
      }),
    );
    return {
      eligible: true,
      booking: booking ? pickupBookingDto(booking, now) : null,
      windows: choices,
    };
  }
}

export class ListMyPickup {
  constructor(
    private readonly pickup: PickupRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor): Promise<PickupBookingDto[]> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const now = this.clock.now();
    return (await this.pickup.listActiveForStudent(actor.studentId)).map(
      (booking) => pickupBookingDto(booking, now),
    );
  }
}

export class BookRequestPickup {
  constructor(
    private readonly uow: UnitOfWork<RequestTransaction>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly limiter: RateLimiter,
  ) {}
  async execute(actor: Actor, input: unknown): Promise<PickupBookingDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const data = parsePickupBooking(input);
    await reservePickupChange(this.limiter, actor.userId);
    return this.uow.run(async (tx) => {
      const pickup = requirePickup(tx);
      const request = await tx.requests.findByIdForStudent(
        data.id,
        actor.studentId,
        true,
      );
      if (!request) throw new NotFoundError();
      const type = await tx.requests.findType(request.typeCode);
      if (!type) throw new NotFoundError();
      if (!pickupEligible(request.status, type.delivery, type.isCertificate))
        throw new ValidationError({
          pickup: ["pickupNotEligible"],
        });
      const window = await pickup.findWindowForFaculty(
        data.windowId,
        request.facultyId,
      );
      if (!window) throw new NotFoundError();
      const now = this.clock.now();
      assertPickupSlot(data.slotStartsAt, now, window);
      const initial = await pickup.findActiveForRequestForStudent(
        request.id,
        actor.studentId,
      );
      // Lock both daily sequences before releasing an occupied slot.
      await pickup.lockTicketDays([
        { windowId: window.id, day: moscowDate(new Date(data.slotStartsAt)) },
        ...(initial
          ? [
              {
                windowId: initial.windowId,
                day: moscowDate(new Date(initial.slotStartsAt)),
              },
            ]
          : []),
      ]);
      const active = await pickup.findActiveForRequestForStudent(
        request.id,
        actor.studentId,
        true,
      );
      if (active) {
        if (isPickupExpired(active.status, active.slotStartsAt, now)) {
          await pickup.setStatus(active.id, "no_show", active.status);
        } else {
          assertPickupChange(active.status, active.slotStartsAt, now);
          if (
            active.windowId === window.id &&
            active.slotStartsAt === data.slotStartsAt
          )
            return pickupBookingDto(active, now);
          await pickup.setStatus(active.id, "cancelled", active.status);
        }
      }
      const booking: PickupBookingRecord = {
        id: this.ids.next(),
        userId: actor.userId,
        requestId: request.id,
        windowId: window.id,
        windowTitle: window.title,
        slotStartsAt: data.slotStartsAt,
        ticketNo: await pickup.nextTicketNo(
          window.id,
          moscowDate(new Date(data.slotStartsAt)),
        ),
        status: "booked",
        createdAt: now.toISOString(),
      };
      await pickup.insert(booking);
      await tx.requests.save(
        { ...request, updatedAt: now.toISOString() },
        request,
      );
      return pickupBookingDto(booking, now);
    });
  }
}

export class CancelRequestPickup {
  constructor(
    private readonly uow: UnitOfWork<RequestTransaction>,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const data = parsePickupId(input);
    await reservePickupChange(this.limiter, actor.userId);
    return this.uow.run(async (tx) => {
      const pickup = requirePickup(tx);
      const initial = await pickup.findByIdForStudent(data.id, actor.studentId);
      if (!initial) throw new NotFoundError();
      const request = await tx.requests.findByIdForStudent(
        initial.requestId,
        actor.studentId,
        true,
      );
      if (!request) throw new NotFoundError();
      const booking = await pickup.findByIdForStudent(
        data.id,
        actor.studentId,
        true,
      );
      if (!booking) throw new NotFoundError();
      const now = this.clock.now();
      assertPickupChange(booking.status, booking.slotStartsAt, now);
      await pickup.setStatus(booking.id, "cancelled", booking.status);
      await tx.requests.save(
        { ...request, updatedAt: now.toISOString() },
        request,
      );
      return { requestId: request.id };
    });
  }
}
