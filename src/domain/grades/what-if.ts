import { ValidationError } from "../shared/errors";
import { exactWeightedTotal, type GradeWork, gradeFor } from "./grading-policy";

export type Predictions = Readonly<Record<string, number>>;

export function initialPredictions(
  works: readonly GradeWork[],
  target: number,
): Predictions {
  const maximums = Object.fromEntries(
    works
      .filter((work) => work.score === null)
      .map((work) => [work.id, work.maxScore]),
  );
  if (!whatIf(works, maximums, target).targetReachable) return maximums;
  // Reduce a feasible vector so all pending works reach the target together.
  const predictions = { ...maximums };
  for (const work of works.filter((work) => work.score === null)) {
    const minimum = whatIf(works, predictions, target).remaining.find(
      (item) => item.id === work.id,
    )?.minimum;
    predictions[work.id] = minimum ?? work.maxScore;
  }
  return predictions;
}

export function whatIf(
  works: readonly GradeWork[],
  predictions: Predictions,
  target: number,
) {
  gradeFor(target);
  exactWeightedTotal(works);
  for (const [id, value] of Object.entries(predictions)) {
    const work = works.find((item) => item.id === id && item.score === null);
    if (!work || !Number.isInteger(value) || value < 0 || value > work.maxScore)
      throw new ValidationError({
        predictions: ["Проверьте предполагаемые баллы."],
      });
  }
  const projected = (overrides: Predictions) =>
    exactWeightedTotal(
      works.map((work) => ({
        ...work,
        score: work.score ?? overrides[work.id] ?? 0,
      })),
    );
  const maximum = projected(
    Object.fromEntries(
      works
        .filter((work) => work.score === null)
        .map((work) => [work.id, work.maxScore]),
    ),
  );
  const total = projected(predictions);
  const remaining = works
    .filter((work) => work.score === null)
    .map((work) => {
      const skippedTotal = projected({ ...predictions, [work.id]: 0 });
      const submittedTotal = projected({
        ...predictions,
        [work.id]: predictions[work.id] ?? 0,
      });
      const maximumTotal = projected({
        ...predictions,
        [work.id]: work.maxScore,
      });
      let minimum: number | null = null;
      if (maximumTotal.atLeast(target)) {
        minimum = skippedTotal.minimumIncrement(
          target,
          work.weight,
          work.maxScore,
        );
      }
      return {
        id: work.id,
        minimum,
        skippedTotal: skippedTotal.toNumber(),
        submittedTotal: submittedTotal.toNumber(),
        maximumTotal: maximumTotal.toNumber(),
      };
    });
  return {
    total: total.toNumber(),
    grade: gradeFor(total),
    maximum: maximum.toNumber(),
    targetReachable: maximum.atLeast(target),
    remaining,
  };
}
