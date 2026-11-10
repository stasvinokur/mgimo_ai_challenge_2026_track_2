import { expect, it } from "vitest";
import { addWorkDays, getSlaIndicator } from "@/domain/requests/sla-policy";

it.each([
  ["2026-11-06T09:30:00Z", 1, "2026-11-09T09:30:00.000Z"],
  ["2026-10-30T12:00:00Z", 3, "2026-11-04T12:00:00.000Z"],
  ["2026-12-31T09:00:00Z", 2, "2027-01-04T09:00:00.000Z"],
  ["2026-11-07T08:00:00Z", 1, "2026-11-09T08:00:00.000Z"],
  ["2026-11-05T22:30:00Z", 1, "2026-11-08T22:30:00.000Z"],
  ["2026-11-04T09:00:00Z", 0, "2026-11-04T09:00:00.000Z"],
])("%s + %i рабочих дней → %s", (start, days, expected) =>
  expect(addWorkDays(new Date(start), days).toISOString()).toBe(expected),
);
it("индикатор учитывает ровно один рабочий день и выходные", () => {
  const now = new Date("2026-11-06T09:00:00Z");
  expect(getSlaIndicator(new Date("2026-11-06T08:59:59Z"), now)).toBe(
    "overdue",
  );
  expect(getSlaIndicator(now, now)).toBe("soon");
  expect(getSlaIndicator(new Date("2026-11-09T09:00:00Z"), now)).toBe("soon");
  expect(getSlaIndicator(new Date("2026-11-09T09:00:01Z"), now)).toBe(
    "on_time",
  );
});
