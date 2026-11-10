import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "@/ui/primitives/card";
import { CounterTile } from "@/ui/primitives/counter-tile";
import { ProgressRing } from "@/ui/primitives/progress-ring";
import { calculateProgressRing } from "@/ui/primitives/progress-ring-layout";
import { StageBar } from "@/ui/primitives/stage-bar";

describe("кольцо прогресса", () => {
  it("показывает десятичную запятую и долю от цели", () => {
    const ring = calculateProgressRing(78.3, 86);
    expect(ring.accessibleName).toBe("78,3 из 86");
    expect(ring.ratio).toBeCloseTo(78.3 / 86);
    expect(ring.offset).toBeCloseTo(ring.circumference * (1 - 78.3 / 86));
    const html = renderToStaticMarkup(ProgressRing({ value: 78.3, goal: 86 }));
    expect(html).toContain('aria-label="78,3 из 86"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("из 86</span>");
  });

  it.each([
    -20,
    0,
    1,
    86,
    120,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    null,
    undefined,
  ])("значение %s безопасно", (value) => {
    const ring = calculateProgressRing(value, 86);
    expect(ring.ratio).toBeGreaterThanOrEqual(0);
    expect(ring.ratio).toBeLessThanOrEqual(1);
    expect(Number.isFinite(ring.offset)).toBe(true);
    expect(ring.offset).toBeGreaterThanOrEqual(0);
    expect(ring.offset).toBeLessThanOrEqual(ring.circumference);
  });

  it.each([
    [89.5, "89,5", 1],
    [120, "120", 1],
    [86, "86", 1],
    [-1.5, "-1,5", 0],
  ])(
    "ограничивает дугу, сохраняя число %s и доступное имя",
    (value, label, ratio) => {
      const ring = calculateProgressRing(value, 86);
      expect(ring.valueLabel).toBe(label);
      expect(ring.accessibleName).toBe(`${label} из 86`);
      expect(ring.ratio).toBe(ratio);
      expect(ring.offset).toBe(ring.circumference * (1 - ratio));
      const html = renderToStaticMarkup(ProgressRing({ value, goal: 86 }));
      expect(html).toContain(`aria-label="${label} из 86"`);
      expect(html).toContain(`>${label}</span>`);
      if (ratio === 0)
        expect(html).not.toContain('class="progress-ring-value"');
    },
  );

  it("не выдаёт нулевую или некорректную цель за достигнутую", () => {
    for (const goal of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const ring = calculateProgressRing(78.3, goal);
      expect(ring.ratio).toBe(0);
      expect(ring.offset).toBe(ring.circumference);
      expect(ring.accessibleName).toBe("78,3 из 0");
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "некорректное число %s заменяется прочерком с пустой дугой",
    (value) => {
      const ring = calculateProgressRing(value, 86);
      expect(ring.valueLabel).toBe("—");
      expect(ring.accessibleName).toBe("— из 86");
      expect(ring.ratio).toBe(0);
      expect(ring.offset).toBe(ring.circumference);
      const html = renderToStaticMarkup(ProgressRing({ value, goal: 86 }));
      expect(html).toContain('aria-label="— из 86"');
      expect(html).toContain(">—</span>");
      expect(html).not.toContain('class="progress-ring-value"');
    },
  );

  it.each([null, undefined])(
    "отсутствующее значение %s остаётся без данных",
    (value) => {
      const ring = calculateProgressRing(value, 86);
      expect(ring.accessibleName).toBe("Нет данных из 86");
      expect(ring.ratio).toBe(0);
    },
  );
});

it("полоса этапов сообщает текущий этап и ограничивает его диапазоном", () => {
  const html = renderToStaticMarkup(
    StageBar({ total: 5, current: 3, tone: "warning" }),
  );
  expect(html).toContain('aria-label="этап 3 из 5"');
  expect(html.match(/data-complete="true"/g)).toHaveLength(3);
  expect(html.match(/data-complete="false"/g)).toHaveLength(2);
  expect(renderToStaticMarkup(StageBar({ total: 5, current: 9 }))).toContain(
    'aria-label="этап 5 из 5"',
  );
  expect(renderToStaticMarkup(StageBar({ total: 0, current: -1 }))).toContain(
    'aria-label="этап 0 из 0"',
  );
});

it("плитка бывает ссылкой и передаёт число, подпись и семантический тон", () => {
  const html = renderToStaticMarkup(
    CounterTile({
      value: 2,
      label: "Просрочено",
      tone: "danger",
      href: "/staff/requests?sla=overdue",
    }),
  );
  expect(html).toContain('href="/staff/requests?sla=overdue"');
  expect(html).toContain("status-danger");
  expect(html).toContain("<strong>2</strong><span>Просрочено</span>");
  expect(
    renderToStaticMarkup(CounterTile({ value: 0, label: "В срок" })),
  ).toMatch(/^<div/);
});

it("hero — вариант общей карточки", () => {
  const html = renderToStaticMarkup(
    Card({ variant: "hero", children: "Пульс дня" }),
  );
  expect(html).toContain('data-variant="hero"');
  expect(html).toContain("pulse-card");
});
