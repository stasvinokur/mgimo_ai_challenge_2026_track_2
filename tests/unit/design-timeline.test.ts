import { describe, expect, it } from "vitest";
import {
  type DayInterval,
  layoutDayTimeline,
} from "@/ui/primitives/day-timeline-layout";

const dayStart = Date.parse("2026-11-04T06:00:00Z");
const hour = 60 * 60 * 1000;
const dayEnd = dayStart + 9 * hour;
const interval = (
  start: number,
  end: number,
  title = "Политическая география",
): DayInterval => ({
  start: dayStart + start * hour,
  end: dayStart + end * hour,
  title,
});
const layout = (intervals: DayInterval[], width = 320, now = dayStart + hour) =>
  layoutDayTimeline({ intervals, width, now, dayStart, dayEnd });

function expectBounded(result: ReturnType<typeof layout>) {
  for (const point of result.points) {
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(result.width);
  }
  for (const [index, label] of result.labels.entries()) {
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(result.width);
    const next = result.labels[index + 1];
    if (next)
      expect(label.x + label.width + 8).toBeLessThanOrEqual(next.x + 1e-9);
  }
  for (let index = 1; index < result.points.length; index++) {
    expect(result.points[index]?.x).toBeGreaterThanOrEqual(
      result.points[index - 1]?.x ?? 0,
    );
  }
}

describe("линия дня", () => {
  it("соседние занятия дают два всплеска, подписи не пересекаются на 360 px", () => {
    const result = layout([interval(1.75, 3.25), interval(3.25, 4.75)], 288);
    expect(result.points.filter((p) => p.y === 16)).toHaveLength(2);
    expect(result.summary).toContain("10:45–12:15 — Политическая география");
    expect(result.labels.some((label) => label.text === "10:45")).toBe(true);
    expectBounded(result);
  });

  it("нулевой список — прямая и текстовая альтернатива", () => {
    const result = layout([]);
    expect(result.points.every((point) => point.y === 52)).toBe(true);
    expect(result.summary).toContain("Занятий нет");
    expect(result.summary).toContain("День с 09:00 до 18:00");
    expectBounded(result);
  });

  it("сейчас за пределами дня прижимается к краю и поясняется словами", () => {
    const before = layout([], 320, dayStart - hour);
    const after = layout([], 320, dayEnd + hour);
    expect(before.marker).toEqual(before.points[0]);
    expect(after.marker).toEqual(after.points.at(-1));
    expect(before.summary).toContain("до начала дня");
    expect(after.summary).toContain("после конца дня");
  });

  it("маркер лежит на всплеске, а не под ним", () => {
    const result = layout([interval(0, 2)], 320, dayStart + hour * 1.2);
    expect(result.marker?.y).toBeCloseTo(16);
  });

  it("обрезает пересечения с границами и отбрасывает интервалы снаружи", () => {
    const result = layout([
      interval(-2, -1),
      interval(10, 11),
      interval(-1, 1),
      interval(8, 10),
    ]);
    expect(result.points.filter((p) => p.y === 16)).toHaveLength(2);
    expect(result.summary).toContain("09:00–10:00");
    expect(result.summary).toContain("17:00–18:00");
    expect(result.summary).not.toContain("07:00");
    expectBounded(result);
  });

  it("не изменяет исходный список, одинаковые начала и наложения безопасны", () => {
    const entries = [interval(3, 5), interval(1, 4), interval(1, 2)];
    const original = structuredClone(entries);
    expectBounded(layout(entries));
    expect(entries).toEqual(original);
  });

  it("не рисует NaN при ошибочных границах или данных", () => {
    expectBounded(
      layout([
        interval(3, 1),
        { start: Number.NaN, end: dayEnd, title: "Нет даты" },
      ]),
    );
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = layout([], width);
      expect(result.width).toBe(0);
      expect(result.labels).toEqual([]);
      expectBounded(result);
    }
    const invalidDay = layoutDayTimeline({
      intervals: [],
      width: 320,
      dayStart,
      dayEnd: dayStart,
      now: Number.NaN,
    });
    expect(invalidDay.marker).toBeNull();
    expect(invalidDay.labels).toEqual([]);
    expect(invalidDay.summary).toContain("проверьте границы дня");
  });

  it("подписи всегда разделены при плотных, длинных и случайных интервалах", () => {
    let seed = 26;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let sample = 0; sample < 150; sample++) {
      const entries = Array.from({ length: sample % 40 }, () => {
        const start = random() * 12 - 2;
        return interval(
          start,
          start + random() * 3,
          "Очень длинное название дисциплины ".repeat(4),
        );
      });
      for (const width of [20, 80, 160, 288, 320, 600, 960]) {
        const result = layout(entries, width);
        expectBounded(result);
        expect(result.summary).not.toContain("NaN");
      }
    }
  });
});
