import { expect, it } from "vitest";
import {
  assertPickupChange,
  assertPickupSlot,
  assertPickupStaffChange,
  canChangePickup,
  isPickupExpired,
  PICKUP_HOURS,
  pickupDayBounds,
  pickupDays,
  pickupEligible,
  pickupSlots,
} from "@/domain/requests/pickup";
import { ConflictError, ValidationError } from "@/domain/shared/errors";

const now = new Date("2026-11-05T06:00:00.000Z");

it("окна работают по будням 09:00–17:00 МСК, слот длится ровно 10 минут", () => {
  const slots = pickupSlots("2026-11-06", now, PICKUP_HOURS);
  expect(slots).toHaveLength(48);
  expect(slots[0]).toBe("2026-11-06T06:00:00.000Z");
  expect(slots.at(-1)).toBe("2026-11-06T13:50:00.000Z");
  for (let i = 1; i < slots.length; i++)
    expect(Date.parse(slots[i] ?? "") - Date.parse(slots[i - 1] ?? "")).toBe(
      600_000,
    );
  expect(pickupSlots("2026-11-07", now, PICKUP_HOURS)).toEqual([]);
  expect(pickupSlots("2026-11-08", now, PICKUP_HOURS)).toEqual([]);
  expect(pickupSlots("2026-11-05", now, PICKUP_HOURS)[0]).toBe(
    "2026-11-05T06:10:00.000Z",
  );
});

it("часы конкретного окна могут только сузить доменные часы", () => {
  expect(
    pickupSlots("2026-11-06", now, {
      opensAt: "10:05:00",
      closesAt: "10:35:00",
    }),
  ).toEqual(["2026-11-06T07:10:00.000Z", "2026-11-06T07:20:00.000Z"]);
  expect(
    pickupSlots("2026-11-06", now, {
      opensAt: "08:00:00",
      closesAt: "18:00:00",
    }),
  ).toEqual(pickupSlots("2026-11-06", now, PICKUP_HOURS));
});

it.each([
  "2026-11-05T05:50:00.000Z",
  "2026-11-05T06:00:00.000Z",
  "2026-11-05T06:11:00.000Z",
  "2026-11-05T06:10:00.001Z",
  "2026-11-06T14:00:00.000Z",
  "2026-11-06T05:50:00.000Z",
  "2026-11-07T09:00:00.000Z",
  "2026-11-08T09:00:00.000Z",
  "2026-11-12T09:00:00.000Z",
  "не дата",
])("не принимает недопустимый слот %s", (value) => {
  expect(() => assertPickupSlot(value, now, PICKUP_HOURS)).toThrow(
    ValidationError,
  );
});

it("ближайшие рабочие дни и границы дня считаются по Москве", () => {
  expect(pickupDays(new Date("2026-11-06T22:00:00Z"))).toEqual([
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
  ]);
  expect(pickupDayBounds("2026-11-05")).toEqual({
    from: "2026-11-04T21:00:00.000Z",
    to: "2026-11-05T21:00:00.000Z",
  });
  expect(() =>
    assertPickupSlot("2026-11-11T13:50:00.000Z", now, PICKUP_HOURS),
  ).not.toThrow();
});

it("отмена и перенос доступны активному талону строго до начала слота", () => {
  const slot = "2026-11-05T06:10:00.000Z";
  for (const status of ["booked", "called"]) {
    expect(canChangePickup(status, slot, now)).toBe(true);
    expect(() => assertPickupChange(status, slot, new Date(slot))).toThrow(
      ConflictError,
    );
  }
  for (const status of ["served", "cancelled", "no_show"])
    expect(() => assertPickupChange(status, slot, now)).toThrow(ConflictError);
});

it.each(["booked", "called"])(
  "талон %s истекает в полночь по Москве, а не по UTC",
  (status) => {
    const slot = "2026-11-05T09:00:00.000Z";
    const lastMinute = new Date("2026-11-05T20:59:00.000Z");
    const nextDay = new Date("2026-11-05T21:00:00.000Z");
    expect(isPickupExpired(status, slot, lastMinute)).toBe(false);
    expect(
      isPickupExpired(status, slot, new Date("2026-11-05T20:59:59.999Z")),
    ).toBe(false);
    expect(isPickupExpired(status, slot, nextDay)).toBe(true);
    expect(isPickupExpired(status, "2026-11-06T09:00:00Z", nextDay)).toBe(
      false,
    );
    for (const to of ["served", "no_show"] as const) {
      expect(() =>
        assertPickupStaffChange(status, to, slot, lastMinute),
      ).not.toThrow();
      expect(() => assertPickupStaffChange(status, to, slot, nextDay)).toThrow(
        ConflictError,
      );
    }
    expect(canChangePickup(status, slot, lastMinute)).toBe(false);
    expect(canChangePickup(status, slot, nextDay)).toBe(false);
  },
);

it.each(["served", "cancelled", "no_show"])(
  "завершённый талон %s не считается просроченной активной записью",
  (status) => {
    expect(
      isPickupExpired(
        status,
        "2026-11-05T09:00:00Z",
        new Date("2026-11-05T21:00:00Z"),
      ),
    ).toBe(false);
  },
);

it("сотрудник обрабатывает только активные талоны текущего московского дня", () => {
  for (const to of ["called", "served"] as const)
    expect(() =>
      assertPickupStaffChange("booked", to, "2026-11-05T06:10:00.000Z", now),
    ).not.toThrow();
  expect(() =>
    assertPickupStaffChange(
      "called",
      "served",
      "2026-11-05T06:10:00.000Z",
      now,
    ),
  ).not.toThrow();
  expect(() =>
    assertPickupStaffChange(
      "called",
      "called",
      "2026-11-05T06:10:00.000Z",
      now,
    ),
  ).toThrow(ConflictError);
  expect(() =>
    assertPickupStaffChange(
      "no_show",
      "called",
      "2026-11-05T06:10:00.000Z",
      now,
    ),
  ).toThrow(ConflictError);
  expect(() =>
    assertPickupStaffChange(
      "booked",
      "called",
      "2026-11-06T06:10:00.000Z",
      now,
    ),
  ).toThrow(ConflictError);
});

it("запись доступна только для готовой бумажной справки", () => {
  expect(pickupEligible("ready", "pickup", true)).toBe(true);
  for (const status of [
    "draft",
    "submitted",
    "accepted",
    "in_progress",
    "needs_info",
    "issued",
    "cancelled",
    "rejected",
  ])
    expect(pickupEligible(status, "pickup", true)).toBe(false);
  expect(pickupEligible("ready", "pdf", true)).toBe(false);
  expect(pickupEligible("ready", "pickup", false)).toBe(false);
});

it("неявка запрещена до начала слота и разрешена точно на его границе", () => {
  const startsAt = "2026-11-05T06:10:00.000Z";
  for (const status of ["booked", "called"]) {
    expect(() =>
      assertPickupStaffChange(
        status,
        "no_show",
        startsAt,
        new Date("2026-11-05T06:09:59.999Z"),
      ),
    ).toThrow(ConflictError);
    expect(() =>
      assertPickupStaffChange(status, "no_show", startsAt, new Date(startsAt)),
    ).not.toThrow();
    expect(() =>
      assertPickupStaffChange(
        status,
        "no_show",
        startsAt,
        new Date("2026-11-05T06:10:00.001Z"),
      ),
    ).not.toThrow();
  }
});
