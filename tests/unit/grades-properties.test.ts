import { expect, it } from "vitest";
import {
  currentScore,
  type GradeWork,
  gradeFor,
  weightedTotal,
} from "../../src/domain/grades/grading-policy";
import { trafficLight } from "../../src/domain/grades/traffic-light";
import { whatIf } from "../../src/domain/grades/what-if";

it("перебор весов, максимумов и баллов совпадает с целочисленным эталоном", () => {
  let scenarios = 0;
  const targets = [0, 55, 70, 86, 100];
  const now = "2026-11-04T09:00:00Z";
  // All maxima divide 6, so each reference contribution is an exact integer.
  const unit = 6;
  const referenceGrade = (total: number) => ({
    label:
      total >= 86 * unit
        ? "отлично"
        : total >= 70 * unit
          ? "хорошо"
          : total >= 55 * unit
            ? "удовлетворительно"
            : "неудовлетворительно",
    credit: total >= 55 * unit,
  });
  for (let firstWeight = 25; firstWeight <= 50; firstWeight += 25) {
    for (
      let secondWeight = 25;
      secondWeight < 100 - firstWeight;
      secondWeight += 25
    ) {
      const weights = [
        firstWeight,
        secondWeight,
        100 - firstWeight - secondWeight,
      ];
      for (let aMax = 1; aMax <= 3; aMax++) {
        for (let bMax = 1; bMax <= 3; bMax++) {
          for (let cMax = 1; cMax <= 3; cMax++) {
            const maxima = [aMax, bMax, cMax];
            for (let a = 0; a <= aMax; a++) {
              for (let b = 0; b <= bMax; b++) {
                for (let c = 0; c <= cMax; c++) {
                  const scores = [a, b, c];
                  const works: GradeWork[] = scores.map((score, index) => ({
                    id: String(index),
                    title: "Учебная работа",
                    weight: weights[index] ?? 0,
                    maxScore: maxima[index] ?? 0,
                    score,
                    dueAt: "2026-11-05T09:00:00Z",
                    isRequired: true,
                  }));
                  const contribution = (index: number, score: number) =>
                    score *
                    (weights[index] ?? 0) *
                    (unit / (maxima[index] ?? 1));
                  const total =
                    contribution(0, a) +
                    contribution(1, b) +
                    contribution(2, c);
                  expect(weightedTotal(works)).toBe(total / unit);
                  expect(currentScore(works)).toBe(total / unit);
                  expect(gradeFor(weightedTotal(works))).toEqual(
                    referenceGrade(total),
                  );
                  const pending = works.map((work, index) => ({
                    ...work,
                    score: index === 0 ? work.score : null,
                  }));
                  const maximum =
                    contribution(0, a) +
                    contribution(1, bMax) +
                    contribution(2, cMax);
                  for (const target of targets) {
                    const forecast = whatIf(
                      pending,
                      { "1": b, "2": c },
                      target,
                    );
                    expect(forecast.total).toBe(total / unit);
                    expect(forecast.grade).toEqual(referenceGrade(total));
                    expect(forecast.maximum).toBe(maximum / unit);
                    expect(forecast.targetReachable).toBe(
                      maximum >= target * unit,
                    );
                    for (const index of [1, 2]) {
                      const base =
                        total - contribution(index, scores[index] ?? 0);
                      let minimum: number | null = null;
                      for (
                        let candidate = 0;
                        candidate <= (maxima[index] ?? 0);
                        candidate++
                      ) {
                        if (
                          base + contribution(index, candidate) >=
                          target * unit
                        ) {
                          minimum = candidate;
                          break;
                        }
                      }
                      expect(forecast.remaining[index - 1]).toEqual({
                        id: String(index),
                        minimum,
                        skippedTotal: base / unit,
                        submittedTotal: total / unit,
                        maximumTotal:
                          (base + contribution(index, maxima[index] ?? 0)) /
                          unit,
                      });
                    }
                    expect(trafficLight(works, target, now).tone).toBe(
                      total < 55 * unit
                        ? "danger"
                        : total >= target * unit
                          ? "success"
                          : "warning",
                    );
                    expect(trafficLight(pending, target, now).tone).toBe(
                      maximum < 55 * unit
                        ? "danger"
                        : contribution(0, a) >= target * unit
                          ? "success"
                          : "warning",
                    );
                    scenarios++;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  expect(scenarios).toBe(10_935);
}, 30_000);
