import {
  exactWeightedTotal,
  type GradeWork,
} from "@/domain/grades/grading-policy";

export type GradeCode =
  | "excellent"
  | "good"
  | "satisfactory"
  | "unsatisfactory";

export function gradeDto(works: readonly GradeWork[]) {
  const total = exactWeightedTotal(works);
  const code: GradeCode = total.atLeast(86)
    ? "excellent"
    : total.atLeast(70)
      ? "good"
      : total.atLeast(55)
        ? "satisfactory"
        : "unsatisfactory";
  return { code, credit: total.atLeast(55) };
}
