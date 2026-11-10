import { exactWeightedTotal } from "@/domain/grades/grading-policy";
import {
  type ScholarshipForecast as PolicyForecast,
  scholarshipPolicy,
} from "@/domain/grades/scholarship-policy";
import { type Predictions, whatIf } from "@/domain/grades/what-if";
import { ValidationError } from "../shared/errors";
import { gradeDto } from "./messages";
import type { CourseGrades, GradesRecord } from "./ports";

interface ScholarshipCourseData extends CourseGrades {
  openDebts: number;
  works: (CourseGrades["works"][number] & { status: string })[];
}

export interface ScholarshipOutlook {
  state:
    | "retained"
    | "at-risk"
    | "unreachable"
    | "debt"
    | "clarification"
    | "eligible";
  currentScholarship: GradesRecord["scholarship"];
  level: PolicyForecast["level"];
  nextLevel: "academic" | "increased";
  increasedOutlook: "eligible" | "reachable" | "unreachable";
  requirement: {
    minimum: number;
    maxScore: number;
    title: string;
    course: string;
    hasMore: boolean;
  } | null;
  debtTitle: string | null;
}

function describeScholarship(
  forecast: PolicyForecast,
  current: GradesRecord["scholarship"],
  debt: { title: string } | undefined,
): ScholarshipOutlook {
  const requirements =
    forecast.next?.courses.flatMap((course) =>
      course.requirements.map((work) => ({ ...work, course: course.title })),
    ) ?? [];
  const first = requirements.find((work) => work.minimum > 0);
  const retainsCurrent =
    current !== "none" &&
    (forecast.level === "increased" ||
      (current === "academic" && forecast.level === "academic"));
  return {
    state: debt
      ? "debt"
      : forecast.status === "clarification"
        ? "clarification"
        : retainsCurrent
          ? "retained"
          : current === "none" && forecast.level !== "none"
            ? "eligible"
            : forecast.next?.reachable === false
              ? "unreachable"
              : "at-risk",
    currentScholarship: current,
    level: forecast.level,
    nextLevel: forecast.next?.level === "increased" ? "increased" : "academic",
    increasedOutlook:
      forecast.level === "increased"
        ? "eligible"
        : forecast.next?.reachable
          ? "reachable"
          : "unreachable",
    requirement: first
      ? {
          minimum: first.minimum,
          maxScore: first.maxScore,
          title: first.title,
          course: first.course,
          hasMore: requirements.length > 1,
        }
      : null,
    debtTitle: debt?.title ?? null,
  };
}

export type ScholarshipBlocker =
  | { courseId: string; title: string; code: "debt" | "clarification" }
  | {
      courseId: string;
      title: string;
      code: "below-threshold";
      threshold: number;
      grade: ReturnType<typeof gradeDto>;
    };

export function calculateScholarship(
  courses: readonly ScholarshipCourseData[],
  currentScholarship: GradesRecord["scholarship"],
  simulation?: {
    courseId: string;
    predictions: Predictions;
    skipped: Readonly<Record<string, boolean>>;
  },
) {
  const inputs = courses.map((course) => {
    const selected = simulation?.courseId === course.id ? simulation : null;
    return {
      id: course.id,
      title: course.title,
      works: course.works,
      hasDebt: selected
        ? course.works.some(
            (work) =>
              work.isRequired &&
              work.score === null &&
              (selected.skipped[work.id] ||
                (work.status === "overdue" &&
                  selected.predictions[work.id] === undefined)),
          )
        : course.openDebts > 0,
      predictions: selected?.predictions,
    };
  });
  const forecast = scholarshipPolicy(inputs, currentScholarship);
  const blockers = inputs.flatMap((course): ScholarshipBlocker[] => {
    const base = { courseId: course.id, title: course.title };
    const items: ScholarshipBlocker[] = course.hasDebt
      ? [{ ...base, code: "debt" }]
      : [];
    const projected = course.works.map((work) => ({
      ...work,
      score: work.score ?? course.predictions?.[work.id] ?? 0,
    }));
    try {
      whatIf(course.works, course.predictions ?? {}, 70);
      const total = exactWeightedTotal(projected);
      if (forecast.next && !total.atLeast(forecast.next.threshold))
        items.push({
          ...base,
          code: "below-threshold",
          threshold: forecast.next.threshold,
          grade: gradeDto(projected),
        });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      items.push({ ...base, code: "clarification" });
    }
    return items;
  });
  return {
    ...forecast,
    blockers,
    currentScholarship,
    outlook: describeScholarship(
      forecast,
      currentScholarship,
      inputs.find((course) => course.hasDebt),
    ),
  };
}

export type ScholarshipForecast = ReturnType<typeof calculateScholarship>;
