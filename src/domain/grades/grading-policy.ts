import { ValidationError } from "../shared/errors";
import { ExactScore } from "./exact-score";

export interface GradeWork {
  id: string;
  title: string;
  weight: number;
  maxScore: number;
  score: number | null;
  dueAt: string;
  isRequired: boolean;
}

export function validateWorks(works: readonly GradeWork[]) {
  if (
    works.length === 0 ||
    new Set(works.map((work) => work.id)).size !== works.length ||
    works.reduce((sum, work) => sum + work.weight, 0) !== 100 ||
    works.some(
      (work) =>
        !Number.isInteger(work.weight) ||
        work.weight <= 0 ||
        !Number.isInteger(work.maxScore) ||
        work.maxScore <= 0 ||
        !Number.isFinite(Date.parse(work.dueAt)) ||
        (work.score !== null &&
          (!Number.isFinite(work.score) ||
            work.score < 0 ||
            work.score > work.maxScore)),
    )
  ) {
    throw new ValidationError({
      grades: ["Не удалось проверить учебные данные."],
    });
  }
}

export function gradeFor(score: number | ExactScore) {
  if (
    typeof score === "number" &&
    (!Number.isFinite(score) || score < 0 || score > 100)
  )
    throw new ValidationError({ score: ["Балл должен быть от 0 до 100."] });
  const exact = typeof score === "number" ? ExactScore.from(score) : score;
  return {
    label: exact.atLeast(86)
      ? "отлично"
      : exact.atLeast(70)
        ? "хорошо"
        : exact.atLeast(55)
          ? "удовлетворительно"
          : "неудовлетворительно",
    credit: exact.atLeast(55),
  };
}

export function exactWeightedTotal(works: readonly GradeWork[]) {
  validateWorks(works);
  return works.reduce(
    (sum, work) =>
      sum.add(
        ExactScore.from(work.score ?? 0).scale(work.weight, work.maxScore),
      ),
    ExactScore.from(0),
  );
}

export function weightedTotal(works: readonly GradeWork[]) {
  return exactWeightedTotal(works).toNumber();
}

function exactCurrentScore(works: readonly GradeWork[]): ExactScore | null {
  const total = exactWeightedTotal(works);
  const gradedWeight = works.reduce(
    (sum, work) => sum + (work.score === null ? 0 : work.weight),
    0,
  );
  return gradedWeight === 0 ? null : total.scale(100, gradedWeight);
}

export function currentScore(works: readonly GradeWork[]): number | null {
  return exactCurrentScore(works)?.toNumber() ?? null;
}

export function averageCurrentScore(
  courses: readonly (readonly GradeWork[])[],
): number | null {
  const scores = courses.flatMap((works) => {
    const score = exactCurrentScore(works);
    return score === null ? [] : [score];
  });
  return scores.length === 0
    ? null
    : scores
        .reduce((sum, score) => sum.add(score), ExactScore.from(0))
        .scale(1, scores.length)
        .toNumber();
}

export function workStatus(work: GradeWork, now: string) {
  if (work.score !== null) return "graded";
  return Date.parse(work.dueAt) < Date.parse(now) ? "overdue" : "upcoming";
}
