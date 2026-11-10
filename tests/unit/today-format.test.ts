import { expect, it } from "vitest";
import type { RequestStatus } from "@/application/requests/dto";
import {
  dayTimeline,
  greeting,
  requestStage,
  todayDateHeading,
} from "@/ui/today/format";
import { todayFixture } from "../fakes/today";

it.each([
  ["2026-11-04T20:59:59Z", "Добрый вечер"],
  ["2026-11-04T21:00:00Z", "Доброй ночи"],
  ["2026-11-05T02:59:59Z", "Доброй ночи"],
  ["2026-11-05T03:00:00Z", "Доброе утро"],
  ["2026-11-05T08:59:59Z", "Доброе утро"],
  ["2026-11-05T09:00:00Z", "Добрый день"],
  ["2026-11-05T14:59:59Z", "Добрый день"],
  ["2026-11-05T15:00:00Z", "Добрый вечер"],
])("приветствие на границе московских часов %s", (now, label) => {
  expect(greeting(now)).toBe(label);
});

it("дата переходит на следующий день по Москве раньше UTC", () => {
  expect(todayDateHeading("2026-11-04T21:00:00Z")).toBe("Четверг, 5 ноября");
});

it("линия содержит только действующие пары и даёт запас для одного занятия", async () => {
  const d = todayFixture();
  const data = await d.sources.schedule(d.anna);
  const line = dayTimeline(data);
  expect(data.lessons).toHaveLength(2);
  expect(line.intervals).toHaveLength(1);
  expect(line.intervals[0]?.start).toBe(Date.parse("2026-11-04T10:00:00Z"));
  expect(line.dayEnd - line.dayStart).toBeGreaterThanOrEqual(4 * 3_600_000);
  expect(line.dayStart).toBeLessThan(line.intervals[0]?.start ?? 0);
  expect(line.dayEnd).toBeGreaterThan(line.intervals[0]?.end ?? Infinity);
});

it("границы следуют первой и последней паре, включая смену аудитории", async () => {
  const d = todayFixture();
  const data = await d.sources.schedule(d.anna);
  const lesson = data.lessons.find((item) => item.status === "moved-to");
  if (!lesson) throw new Error("Нужна перенесённая пара.");
  data.lessons = [
    {
      ...lesson,
      status: "scheduled",
      startsAt: "2026-11-04T05:00:00Z",
      endsAt: "2026-11-04T06:30:00Z",
    },
    {
      ...lesson,
      startsAt: "2026-11-04T15:00:00Z",
      endsAt: "2026-11-04T16:30:00Z",
    },
    { ...lesson, status: "cancelled", startsAt: "2026-11-04T04:00:00Z" },
  ];
  const line = dayTimeline(data);
  expect(line.intervals).toHaveLength(2);
  expect(line.dayStart).toBe(Date.parse("2026-11-04T04:30:00Z"));
  expect(line.dayEnd).toBe(Date.parse("2026-11-04T17:00:00Z"));
});

it("пустая линия и ночная пара остаются в пределах московского дня", async () => {
  const d = todayFixture();
  const data = await d.sources.schedule(d.anna);
  const empty = dayTimeline({ ...data, lessons: [] });
  expect(empty.intervals).toEqual([]);
  expect(empty.dayStart).toBeLessThan(empty.dayEnd);
  const lesson = data.lessons[0];
  if (!lesson) throw new Error("Нужна пара.");
  const night = dayTimeline({
    ...data,
    lessons: [
      {
        ...lesson,
        status: "scheduled",
        startsAt: "2026-11-03T21:00:00Z",
        endsAt: "2026-11-04T20:59:00Z",
      },
    ],
  });
  expect(night.dayStart).toBe(Date.parse("2026-11-03T21:00:00Z"));
  expect(night.dayEnd).toBe(Date.parse("2026-11-04T21:00:00Z"));
});

it("этапы используют закрытые коды статусов", () => {
  for (const [index, key] of [
    "submitted",
    "accepted",
    "in_progress",
    "ready",
    "issued",
  ].entries()) {
    expect(requestStage(key as RequestStatus)).toBe(index + 1);
  }
  expect(requestStage("cancelled")).toBe(0);
});
