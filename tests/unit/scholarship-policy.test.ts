import { expect, it } from "vitest";
import type { GradeWork } from "../../src/domain/grades/grading-policy";
import {
  type ScholarshipCourse,
  scholarshipPolicy,
} from "../../src/domain/grades/scholarship-policy";

function course(
  scores: readonly (number | null)[],
  weights = [45, 45, 10],
  maxima = [100, 100, 100],
): ScholarshipCourse {
  return {
    id: "course",
    title: "Дисциплина",
    hasDebt: false,
    works: scores.map(
      (score, index): GradeWork => ({
        id: String(index),
        title: `Работа ${index}`,
        score,
        weight: weights[index] ?? 0,
        maxScore: maxima[index] ?? 100,
        dueAt: "2026-12-01T09:00:00Z",
        isRequired: true,
      }),
    ),
  };
}

it.each([
  [[46, 96, 61], "academic"],
  [[77, 99, 68], "increased"],
  [[4, 96, 100], "none"],
] as const)("точный порог нескольких работ %j даёт %s", (scores, level) => {
  expect(scholarshipPolicy([course(scores)]).level).toBe(level);
});

it.each([
  [[99, 100, 40], "none"],
  [[99, 100, 72], "academic"],
] as const)(
  "на 0,01 ниже порога нельзя округлять вверх: %j",
  (scores, level) => {
    expect(scholarshipPolicy([course(scores, [1, 49, 50])]).level).toBe(level);
  },
);

it("удовлетворительно и долг объясняются по дисциплинам, высокий средний не помогает", () => {
  const excellent = { ...course([100, 100, 100]), id: "excellent" };
  const satisfactory = course([60, 60, 60]);
  const forecast = scholarshipPolicy([excellent, satisfactory]);
  expect(forecast.level).toBe("none");
  expect(forecast.blockers).toEqual([
    {
      courseId: "course",
      title: "Дисциплина",
      reason: "Итог ниже 70 — удовлетворительно",
    },
  ]);
  expect(forecast.next?.reachable).toBe(false);
  expect(
    forecast.next?.courses.find((item) => item.courseId === "course")
      ?.reachable,
  ).toBe(false);
  const debt = scholarshipPolicy([{ ...excellent, hasDebt: true }]);
  expect(debt.level).toBe("none");
  expect(debt.blockers[0]?.reason).toContain("Долг");
  expect(debt.next?.reachable).toBe(false);
});

it("все дисциплины семестра влияют на уровень", () => {
  expect(
    scholarshipPolicy([
      course([100, 100, 100]),
      { ...course([70, 70, 70]), id: "second" },
    ]).level,
  ).toBe("academic");
});

it("набор минимумов нескольких работ совместно достижим и каждый балл минимален", () => {
  const input = course([50, null, null], [30, 35, 35]);
  const before = structuredClone(input);
  const forecast = scholarshipPolicy([input]);
  const requirements = forecast.next?.courses[0]?.requirements ?? [];
  expect(forecast.next).toMatchObject({ level: "academic", reachable: true });
  expect(requirements.map((item) => item.minimum)).toEqual([58, 100]);
  const predictions = Object.fromEntries(
    requirements.map((item) => [item.workId, item.minimum]),
  );
  expect(scholarshipPolicy([{ ...input, predictions }]).level).toBe("academic");
  for (const item of requirements) {
    expect(
      scholarshipPolicy([
        {
          ...input,
          predictions: { ...predictions, [item.workId]: item.minimum - 1 },
        },
      ]).level,
    ).toBe("none");
  }
  expect(input).toEqual(before);
});

it.each(
  [
    [],
    [{ ...course([80, 80, 80]), works: [] }],
    [course([101, 90, 90])],
    [course([80, 80, 80], [44, 45, 10])],
  ].map((input) => ({ input })),
)(
  "неполные данные требуют уточнения без ложного положительного прогноза",
  ({ input }) => {
    const forecast = scholarshipPolicy(input);
    expect(forecast.status).toBe("clarification");
    expect(forecast.level).toBe("none");
    expect(forecast.next?.reachable).toBeNull();
  },
);

it("повреждённая дисциплина не скрывает известный долг и расчёты остальных", () => {
  const input = course([50, null, null], [30, 35, 35]);
  const forecast = scholarshipPolicy([
    input,
    { ...course([]), id: "invalid", hasDebt: true },
  ]);
  expect(forecast.status).toBe("clarification");
  expect(forecast.next?.reachable).toBe(false);
  expect(forecast.next?.courses[0]?.requirements).toHaveLength(2);
  expect(forecast.blockers).toHaveLength(3);
});

it("property: уровни и минимумы совпадают с независимым целочисленным эталоном", () => {
  let scenarios = 0;
  for (let a = 0; a <= 3; a++) {
    for (let b = 0; b <= 7; b++) {
      for (let c = 0; c <= 11; c++) {
        for (const hasDebt of [false, true]) {
          const input = {
            ...course([a, b, null], [45, 45, 10], [3, 7, 11]),
            hasDebt,
            predictions: { "2": c },
          };
          const integerTotal = (candidate: number) =>
            a * 77 * 45 + b * 33 * 45 + candidate * 21 * 10;
          const level = hasDebt
            ? "none"
            : integerTotal(c) >= 86 * 231
              ? "increased"
              : integerTotal(c) >= 70 * 231
                ? "academic"
                : "none";
          const actual = scholarshipPolicy([input]);
          expect(actual.level).toBe(level);
          if (actual.next) {
            const target = level === "academic" ? 86 : 70;
            let minimum: number | null = null;
            for (let candidate = 0; candidate <= 11; candidate++) {
              if (integerTotal(candidate) >= target * 231) {
                minimum = candidate;
                break;
              }
            }
            expect(actual.next.reachable).toBe(!hasDebt && minimum !== null);
            const requirement = actual.next.courses[0]?.requirements[0];
            if (integerTotal(c) < target * 231 && minimum !== null)
              expect(requirement?.minimum).toBe(minimum);
            else expect(requirement).toBeUndefined();
          }
          scenarios++;
        }
      }
    }
  }
  expect(scenarios).toBe(768);
}, 30_000);
