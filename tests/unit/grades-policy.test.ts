import { describe, expect, it } from "vitest";
import {
  averageCurrentScore,
  currentScore,
  type GradeWork,
  gradeFor,
  weightedTotal,
  workStatus,
} from "../../src/domain/grades/grading-policy";
import { trafficLight } from "../../src/domain/grades/traffic-light";
import { whatIf } from "../../src/domain/grades/what-if";
import { ValidationError } from "../../src/domain/shared/errors";
import { gradesFixture } from "../fakes/grades";

const work: GradeWork = {
  id: "test",
  title: "Тест",
  weight: 100,
  maxScore: 100,
  score: null,
  dueAt: "2026-11-05T09:00:00Z",
  isRequired: true,
};

describe("Пороги без предварительного округления", () => {
  it.each([
    [0, "неудовлетворительно", false],
    [54.99, "неудовлетворительно", false],
    [55, "удовлетворительно", true],
    [69.99, "удовлетворительно", true],
    [70, "хорошо", true],
    [85.99, "хорошо", true],
    [86, "отлично", true],
    [100, "отлично", true],
  ] as const)("%s → %s", (score, label, credit) => {
    expect(gradeFor(weightedTotal([{ ...work, score }]))).toEqual({
      label,
      credit,
    });
  });
  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "отвергает балл %s",
    (score) => {
      expect(() => gradeFor(score)).toThrow(ValidationError);
    },
  );
  it("считает разные максимумы по весу, сохраняя дроби", () => {
    expect(
      weightedTotal([
        { ...work, id: "a", weight: 40, score: 3, maxScore: 7 },
        { ...work, weight: 60, score: 9, maxScore: 11 },
      ]),
    ).toBe(5100 / 77);
    expect(currentScore([work])).toBeNull();
    expect(currentScore([{ ...work, score: 0 }])).toBe(0);
  });
  it.each([0, 99, 101])("веса %s вместо 100 — ошибка данных", (weight) => {
    expect(() => weightedTotal([{ ...work, weight }])).toThrow(ValidationError);
  });
  it.each([
    { score: 101 },
    { score: -1 },
    { score: Number.NaN },
    { maxScore: 0 },
    { dueAt: "ошибка" },
  ])("повреждённая работа %j", (override) => {
    expect(() => whatIf([{ ...work, ...override }], {}, 70)).toThrow(
      ValidationError,
    );
  });
  it("пустые и повторяющиеся работы отклоняются", () => {
    expect(() => weightedTotal([])).toThrow(ValidationError);
    expect(() =>
      weightedTotal([
        { ...work, weight: 50 },
        { ...work, weight: 50 },
      ]),
    ).toThrow(ValidationError);
  });
});

describe("Точные взвешенные пороги", () => {
  const now = "2026-11-04T09:00:00Z";
  const atThreshold = [
    { target: 55, scores: [4, 96, 100], label: "удовлетворительно" },
    { target: 70, scores: [46, 96, 61], label: "хорошо" },
    { target: 86, scores: [77, 99, 68], label: "отлично" },
  ];

  it.each(atThreshold)(
    "$scores при весах 45/45/10 дают ровно $target",
    ({ target, scores, label }) => {
      const works = scores.map((score, index) => ({
        ...work,
        id: String(index),
        weight: index === 2 ? 10 : 45,
        score,
      }));
      expect(weightedTotal(works)).toBe(target);
      expect(currentScore(works)).toBe(target);
      expect(gradeFor(weightedTotal(works))).toEqual({ label, credit: true });
      expect(whatIf(works, {}, target)).toMatchObject({
        total: target,
        maximum: target,
        grade: { label, credit: true },
        targetReachable: true,
      });
      expect(trafficLight(works, target, now).tone).toBe("success");

      const pending = works.map((item, index) => ({
        ...item,
        score: index === 2 ? null : item.score,
      }));
      const minimum = scores[2];
      if (minimum === undefined) throw new Error("Нет балла последней работы.");
      const forecast = whatIf(pending, { "2": minimum }, target);
      expect(forecast.total).toBe(target);
      expect(forecast.grade).toEqual({ label, credit: true });
      expect(forecast.remaining).toEqual([
        {
          id: "2",
          minimum,
          skippedTotal: target - minimum / 10,
          submittedTotal: target,
          maximumTotal: target + (100 - minimum) / 10,
        },
      ]);
      expect(whatIf(pending, { "2": minimum - 1 }, target).total).toBeLessThan(
        target,
      );
      expect(trafficLight(pending, target, now).tone).toBe("warning");
    },
  );

  it.each([
    {
      target: 55,
      scores: [0, 51, 60],
      label: "неудовлетворительно",
      minimum: 61,
    },
    {
      target: 70,
      scores: [0, 51, 90],
      label: "удовлетворительно",
      minimum: 91,
    },
    { target: 86, scores: [22, 73, 100], label: "хорошо", minimum: null },
  ])(
    "на 0,01 ниже $target порог не достигнут",
    ({ target, scores, label, minimum }) => {
      const weights = [1, 49, 50];
      const works = scores.map((score, index) => ({
        ...work,
        id: String(index),
        weight: weights[index] ?? 0,
        score,
      }));
      expect(weightedTotal(works)).toBe(target - 0.01);
      expect(whatIf(works, {}, target)).toMatchObject({
        grade: { label, credit: target !== 55 },
        targetReachable: false,
      });
      expect(trafficLight(works, target, now).tone).toBe(
        target === 55 ? "danger" : "warning",
      );
      const pending = works.map((item, index) => ({
        ...item,
        score: index === 2 ? null : item.score,
      }));
      expect(
        whatIf(pending, { "2": scores[2] ?? 0 }, target).remaining[0]?.minimum,
      ).toBe(minimum);
    },
  );

  it("не округляет отдельные вклады и сравнивает с дробной целью", () => {
    const works = [
      { ...work, id: "a", weight: 45, maxScore: 3, score: 1 },
      { ...work, id: "b", weight: 45, maxScore: 7, score: 6 },
      { ...work, id: "c", weight: 10, maxScore: 7, score: 1 },
    ];
    expect(weightedTotal(works)).toBe(55);
    expect(whatIf(works, {}, 55).grade.credit).toBe(true);
    const pending = works.map((item) => ({
      ...item,
      score: item.id === "c" ? null : item.score,
    }));
    expect(whatIf(pending, {}, 55).remaining[0]?.minimum).toBe(1);
    expect(whatIf(pending, {}, 55.01).remaining[0]?.minimum).toBe(2);
    expect(trafficLight(works, 55.01, now).tone).toBe("warning");
  });

  it("десятичные баллы и экспоненциальная запись не меняют точный порог", () => {
    const works = [
      { ...work, id: "a", weight: 90, score: 61.1 },
      { ...work, id: "b", weight: 10, score: 0.1 },
    ];
    expect(weightedTotal(works)).toBe(55);
    expect(whatIf(works, {}, 55).grade.credit).toBe(true);
    expect(weightedTotal([{ ...work, score: 1e-7 }])).toBe(1e-7);
    expect(weightedTotal([{ ...work, score: 8.6e22, maxScore: 1e23 }])).toBe(
      86,
    );
    expect(weightedTotal([{ ...work, score: Number.MIN_VALUE }])).toBe(
      Number.MIN_VALUE,
    );
  });

  it("сравнение не зависит от округления числового DTO", () => {
    const works = [
      { ...work, id: "a", weight: 85, maxScore: 1, score: 1 },
      { ...work, id: "b", weight: 1, maxScore: 1e17, score: 1e17 - 16 },
      { ...work, id: "c", weight: 14, score: 0 },
    ];
    expect(weightedTotal(works)).toBe(86);
    expect(whatIf(works, {}, 86)).toMatchObject({
      grade: { label: "хорошо" },
      targetReachable: false,
    });
    expect(trafficLight(works, 86, now).tone).toBe("warning");
  });

  it("средний балл сравнивается с целью без погрешности сложения", () => {
    const courses = [89.06, 94.64, 85.22, 75.08].map((score) => [
      { ...work, score },
    ]);
    expect(averageCurrentScore(courses)).toBe(86);
    expect(averageCurrentScore([...courses, [work]])).toBe(86);
    expect(averageCurrentScore([])).toBeNull();
    expect(averageCurrentScore([[work]])).toBeNull();
  });
});

describe("Что если и светофор", () => {
  it("реальный сид Анны: 78,3 при пропуске, 77 для цели 86, текущий 87", () => {
    const d = gradesFixture();
    const works = d.records.get(d.ctx.row("student:anna").id)?.courses[0]
      ?.works;
    if (!works) throw new Error("Нет работ Анны.");
    const before = structuredClone(works);
    const id = works.find((item) => item.score === null)?.id ?? "";
    const forecast = whatIf(works, {}, 86);
    expect(forecast.total).toBeCloseTo(78.3);
    expect(forecast.remaining[0]?.minimum).toBe(77);
    expect(currentScore(works)).toBeCloseTo(87);
    expect(whatIf(works, { [id]: 76 }, 86).total).toBeLessThan(86);
    expect(whatIf(works, { [id]: 77 }, 86)).toMatchObject({
      total: 86,
      grade: { label: "отлично", credit: true },
    });
    expect(whatIf(works, { [id]: 100 }, 86).total).toBeCloseTo(88.3);
    expect(trafficLight(works, 86, d.clock.now().toISOString())).toMatchObject({
      tone: "warning",
      label: "На грани",
    });
    expect(works).toEqual(before);
  });
  it("при нескольких работах минимум зависит от баллов за другие работы", () => {
    const works = [
      { ...work, id: "a", weight: 50 },
      { ...work, id: "b", weight: 50 },
    ];
    expect(whatIf(works, {}, 70).remaining[0]?.minimum).toBeNull();
    expect(whatIf(works, { b: 80 }, 70).remaining[0]?.minimum).toBe(60);
    expect(whatIf(works, { a: 60, b: 80 }, 70).total).toBe(70);
  });
  it("цель недостижима, но зачёт достижим", () => {
    const works = [
      { ...work, id: "a", weight: 90, score: 60 },
      { ...work, weight: 10 },
    ];
    expect(whatIf(works, {}, 86)).toMatchObject({
      maximum: 64,
      targetReachable: false,
      remaining: [{ minimum: null }],
    });
    expect(trafficLight(works, 86, "2026-11-04T09:00:00Z")).toMatchObject({
      tone: "warning",
    });
  });
  it("максимум ниже 55 требует плана действий", () => {
    const works = [
      { ...work, id: "a", weight: 90, score: 40 },
      { ...work, weight: 10 },
    ];
    expect(trafficLight(works, 70, "2026-11-04T09:00:00Z")).toMatchObject({
      tone: "danger",
      label: "Нужен план действий",
    });
  });
  it("долг приоритетнее достаточных баллов, а оценённая работа не просрочена", () => {
    const works = [
      { ...work, id: "a", weight: 90, score: 100 },
      { ...work, weight: 10 },
    ];
    expect(trafficLight(works, 86, "2026-11-06T09:00:00Z")).toMatchObject({
      tone: "danger",
      label: "Есть долг",
    });
    expect(trafficLight(works, 86, "2026-11-04T09:00:00Z")).toMatchObject({
      tone: "success",
    });
    expect(workStatus({ ...work, score: 0 }, "2026-11-06T09:00:00Z")).toBe(
      "graded",
    );
    expect(workStatus(work, work.dueAt)).toBe("upcoming");
    expect(workStatus(work, "2026-11-05T09:00:00.001Z")).toBe("overdue");
  });
  it("ноль для цели уже набран, полный максимум и нет оставшихся работ", () => {
    expect(whatIf([work], {}, 0).remaining[0]?.minimum).toBe(0);
    expect(whatIf([work], {}, 100).remaining[0]?.minimum).toBe(100);
    expect(whatIf([{ ...work, score: 90 }], {}, 86)).toMatchObject({
      total: 90,
      remaining: [],
      targetReachable: true,
    });
  });
  it.each<Record<string, number>>([
    { test: -1 },
    { test: 101 },
    { test: 1.5 },
    { test: Number.NaN },
    { stranger: 70 },
  ])("некорректный прогноз %j", (predictions) => {
    expect(() => whatIf([work], predictions, 70)).toThrow(ValidationError);
  });
  it("прогноз не подменяет уже выставленную оценку", () => {
    expect(() => whatIf([{ ...work, score: 90 }], { test: 100 }, 70)).toThrow(
      ValidationError,
    );
  });
});
