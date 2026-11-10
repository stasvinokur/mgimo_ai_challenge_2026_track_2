import { addDays, atMoscow, moscowDate, weekday } from "../schedule/dates";
import { ConflictError, ValidationError } from "../shared/errors";

export const PICKUP_HOURS = {
  opensAt: "09:00:00",
  closesAt: "17:00:00",
} as const;
export const PICKUP_SLOT_MINUTES = 10;
export const PICKUP_DAYS = 5;
const SLOT_MS = PICKUP_SLOT_MINUTES * 60_000;

export function pickupEligible(
  status: string,
  delivery: string,
  isCertificate: boolean,
) {
  return status === "ready" && delivery === "pickup" && isCertificate;
}

export function pickupDays(now: Date): string[] {
  const result: string[] = [];
  let day = moscowDate(now);
  while (result.length < PICKUP_DAYS) {
    if (weekday(day) <= 5) result.push(day);
    day = addDays(day, 1);
  }
  return result;
}

export function pickupDayBounds(day: string) {
  return {
    from: atMoscow(day, "00:00:00"),
    to: atMoscow(addDays(day, 1), "00:00:00"),
  };
}

export function pickupSlots(
  day: string,
  now: Date,
  window: { opensAt: string; closesAt: string },
): string[] {
  if (weekday(day) > 5) return [];
  const start = Math.max(
    Date.parse(atMoscow(day, PICKUP_HOURS.opensAt)),
    Date.parse(atMoscow(day, window.opensAt)),
  );
  const end = Math.min(
    Date.parse(atMoscow(day, PICKUP_HOURS.closesAt)),
    Date.parse(atMoscow(day, window.closesAt)),
  );
  const result: string[] = [];
  for (
    let slot = Math.ceil(start / SLOT_MS) * SLOT_MS;
    slot + SLOT_MS <= end;
    slot += SLOT_MS
  )
    if (slot > now.getTime()) result.push(new Date(slot).toISOString());
  return result;
}

export function assertPickupSlot(
  value: string,
  now: Date,
  window: { opensAt: string; closesAt: string },
) {
  const slot = new Date(value);
  if (
    !Number.isFinite(slot.getTime()) ||
    !pickupDays(now).includes(moscowDate(slot)) ||
    !pickupSlots(moscowDate(slot), now, window).includes(slot.toISOString())
  )
    throw new ValidationError({
      slotStartsAt: ["pickupInvalidSlot"],
    });
}

export function canChangePickup(
  status: string,
  slotStartsAt: string,
  now: Date,
) {
  return (
    ["booked", "called"].includes(status) &&
    Date.parse(slotStartsAt) > now.getTime()
  );
}

export function isPickupExpired(
  status: string,
  slotStartsAt: string,
  now: Date,
) {
  return (
    ["booked", "called"].includes(status) &&
    moscowDate(new Date(slotStartsAt)) < moscowDate(now)
  );
}

export function assertPickupChange(
  status: string,
  slotStartsAt: string,
  now: Date,
) {
  if (!canChangePickup(status, slotStartsAt, now)) throw new ConflictError();
}

export function assertPickupStaffChange(
  from: string,
  to: "called" | "served" | "no_show",
  slotStartsAt: string,
  now: Date,
) {
  if (
    !["booked", "called"].includes(from) ||
    (from === "called" && to === "called") ||
    (to === "no_show" && Date.parse(slotStartsAt) > now.getTime()) ||
    moscowDate(new Date(slotStartsAt)) !== moscowDate(now)
  )
    throw new ConflictError();
}
