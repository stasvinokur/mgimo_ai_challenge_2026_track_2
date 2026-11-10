import { ValidationError } from "../shared/errors";
import { exactWeightedTotal, type GradeWork, gradeFor } from "./grading-policy";
import { initialPredictions, type Predictions, whatIf } from "./what-if";

export interface ScholarshipCourse {
  id: string;
  title: string;
  works: readonly GradeWork[];
  hasDebt: boolean;
  predictions?: Predictions;
}

export type ScholarshipLevel = "none" | "academic" | "increased";

export function scholarshipPolicy(
  courses: readonly ScholarshipCourse[],
  currentScholarship: ScholarshipLevel = "none",
) {
  const projections = courses.map((course) => {
    try {
      whatIf(course.works, course.predictions ?? {}, 70);
      const total = exactWeightedTotal(
        course.works.map((work) => ({
          ...work,
          score: work.score ?? course.predictions?.[work.id] ?? 0,
        })),
      );
      return { course, total };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      return { course, total: null };
    }
  });
  const clarification =
    courses.length === 0 || projections.some(({ total }) => total === null);
  const qualifies = (threshold: number) =>
    !clarification &&
    projections.every(
      ({ course, total }) => !course.hasDebt && total?.atLeast(threshold),
    );
  const level: ScholarshipLevel = qualifies(86)
    ? "increased"
    : qualifies(70)
      ? "academic"
      : "none";
  const nextLevel =
    level === "increased"
      ? null
      : currentScholarship === "increased" || level === "academic"
        ? "increased"
        : "academic";
  const threshold = nextLevel === "increased" ? 86 : 70;
  const blockers = projections.flatMap(({ course, total }) => {
    const reasons: string[] = [];
    if (course.hasDebt) reasons.push("Долг по обязательной работе");
    if (total === null) reasons.push("Данные по дисциплине требуют уточнения");
    else if (nextLevel && !total.atLeast(threshold)) {
      reasons.push(`Итог ниже ${threshold} — ${gradeFor(total).label}`);
    }
    return reasons.map((reason) => ({
      courseId: course.id,
      title: course.title,
      reason,
    }));
  });
  const improvements = nextLevel
    ? projections.map(({ course, total }) => {
        const base = { courseId: course.id, title: course.title };
        if (!total) return { ...base, reachable: null, requirements: [] };
        const forecast = whatIf(course.works, {}, threshold);
        const predictions = initialPredictions(course.works, threshold);
        return {
          ...base,
          reachable: forecast.targetReachable,
          requirements:
            total.atLeast(threshold) || !forecast.targetReachable
              ? []
              : course.works.flatMap((work) =>
                  work.score === null
                    ? [
                        {
                          workId: work.id,
                          title: work.title,
                          minimum: predictions[work.id] ?? 0,
                          maxScore: work.maxScore,
                        },
                      ]
                    : [],
                ),
        };
      })
    : [];
  const impossible =
    courses.some((course) => course.hasDebt) ||
    improvements.some((course) => course.reachable === false);
  return {
    level,
    status: clarification ? ("clarification" as const) : ("ready" as const),
    blockers,
    next: nextLevel
      ? {
          level: nextLevel,
          threshold,
          reachable: impossible ? false : clarification ? null : true,
          courses: improvements,
        }
      : null,
  };
}

export type ScholarshipForecast = ReturnType<typeof scholarshipPolicy>;
