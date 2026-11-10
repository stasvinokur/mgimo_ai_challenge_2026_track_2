import {
  exactWeightedTotal,
  type GradeWork,
  weightedTotal,
} from "@/domain/grades/grading-policy";
import { type Predictions, whatIf } from "@/domain/grades/what-if";

import { gradeDto } from "./messages";

export type { Predictions } from "@/domain/grades/what-if";
export { initialPredictions } from "@/domain/grades/what-if";

export function calculateWhatIf(
  works: readonly GradeWork[],
  predictions: Predictions,
  target: number,
) {
  const result = whatIf(works, predictions, target);
  const currentTotal = weightedTotal(works);
  const reachesTarget = exactWeightedTotal(
    works.map((work) => ({
      ...work,
      score: work.score ?? predictions[work.id] ?? 0,
    })),
  ).atLeast(target);
  return {
    ...result,
    grade: gradeDto(
      works.map((work) => ({
        ...work,
        score: work.score ?? predictions[work.id] ?? 0,
      })),
    ),
    reachesTarget,
    remaining: result.remaining.map((branch) => {
      const work = works.find((item) => item.id === branch.id);
      if (!work) throw new Error("Не найдена работа для расчёта.");
      const score = predictions[work.id] ?? 0;
      return {
        ...branch,
        outcomes: {
          currentTotal,
          target,
          maxScore: work.maxScore,
          submitted: {
            score,
            total: branch.submittedTotal,
            grade: gradeDto(
              works.map((item) => ({
                ...item,
                score: item.score ?? predictions[item.id] ?? 0,
              })),
            ),
            reachesTarget,
          },
          skipped: {
            total: branch.skippedTotal,
            grade: gradeDto(
              works.map((item) => ({
                ...item,
                score:
                  item.score ??
                  (item.id === work.id ? 0 : (predictions[item.id] ?? 0)),
              })),
            ),
            reachesTarget: branch.minimum === 0,
          },
        },
      };
    }),
  };
}

export type WorkOutcomesDto = ReturnType<
  typeof calculateWhatIf
>["remaining"][number]["outcomes"];
