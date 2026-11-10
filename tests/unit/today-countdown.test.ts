import { expect, it } from "vitest";
import { formatCountdown } from "@/application/today/countdown";
import { FakeClock } from "../fakes/clock";

it.each([
  [0, "Начинается сейчас"],
  [1, "Через 1 мин"],
  [25, "Через 25 мин"],
  [59, "Через 59 мин"],
  [60, "Через 1 ч"],
  [61, "Через 1 ч 1 мин"],
  [135, "Через 2 ч 15 мин"],
  [180, "Через 3 ч"],
])("сегодня через %s минут: %s", (minutes, label) => {
  const clock = new FakeClock("2026-11-04T06:00:00Z");
  const start = new Date(
    clock.now().getTime() + minutes * 60_000,
  ).toISOString();
  expect(formatCountdown(start, clock.now().toISOString())).toBe(label);
});

it.each([
  [-60_000, "Начинается сейчас"],
  [1, "Начинается сейчас"],
  [59_999, "Начинается сейчас"],
  [60_000, "Через 1 мин"],
  [60_001, "Через 2 мин"],
  [59 * 60_000 + 1, "Через 1 ч"],
])("граница и округление %s мс: %s", (milliseconds, label) => {
  const clock = new FakeClock("2026-11-04T06:00:00Z");
  const start = new Date(clock.now().getTime() + milliseconds).toISOString();
  expect(formatCountdown(start, clock.now().toISOString())).toBe(label);
});

it("вечером 815 минут до завтрашней пары становятся «Завтра в 09:00»", () => {
  const clock = new FakeClock("2026-11-04T16:25:00Z");
  expect(
    formatCountdown("2026-11-05T06:00:00Z", clock.now().toISOString()),
  ).toBe("Завтра в 09:00");
});

it("через полночь по Москве завтра превращается в сегодняшний относительный срок", () => {
  const clock = new FakeClock("2026-11-04T20:59:00Z");
  const start = "2026-11-05T06:00:00Z";
  expect(formatCountdown(start, clock.now().toISOString())).toBe(
    "Завтра в 09:00",
  );
  clock.advance(60_000);
  expect(formatCountdown(start, clock.now().toISOString())).toBe("Через 9 ч");
});

it("московский день уже сменился, когда дата UTC ещё прежняя", () => {
  const clock = new FakeClock("2026-11-04T21:30:00Z");
  expect(
    formatCountdown("2026-11-04T23:45:00Z", clock.now().toISOString()),
  ).toBe("Через 2 ч 15 мин");
});

it.each([
  ["2026-11-04T06:00:00Z", "2026-11-06T06:00:00Z", "6 ноября в 09:00"],
  ["2026-11-04T06:00:00Z", "2026-11-11T06:00:00Z", "11 ноября в 09:00"],
  ["2026-11-04T06:00:00Z", "2026-11-05T21:30:00Z", "6 ноября в 00:30"],
  ["2026-11-30T16:00:00Z", "2026-12-01T06:00:00Z", "Завтра в 09:00"],
  ["2026-12-31T16:00:00Z", "2027-01-01T06:00:00Z", "Завтра в 09:00"],
  ["2026-12-31T16:00:00Z", "2027-01-04T06:00:00Z", "4 января в 09:00"],
])("календарный формат %s → %s: %s", (now, start, label) => {
  const clock = new FakeClock(now);
  expect(formatCountdown(start, clock.now().toISOString())).toBe(label);
});

it("минутные обновления проходят границы часов, минут и начала без системных часов", () => {
  const clock = new FakeClock("2026-11-04T06:00:00Z");
  const start = "2026-11-04T07:01:00Z";
  for (const label of ["Через 1 ч 1 мин", "Через 1 ч", "Через 59 мин"]) {
    expect(formatCountdown(start, clock.now().toISOString())).toBe(label);
    clock.advance(60_000);
  }
  clock.advance(57 * 60_000);
  expect(formatCountdown(start, clock.now().toISOString())).toBe("Через 1 мин");
  clock.advance(1);
  expect(formatCountdown(start, clock.now().toISOString())).toBe(
    "Начинается сейчас",
  );
});
