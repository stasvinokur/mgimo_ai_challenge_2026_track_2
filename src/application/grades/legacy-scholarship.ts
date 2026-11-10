import {
  type ScholarshipForecast as PolicyForecast,
  scholarshipPolicy,
} from "@/domain/grades/scholarship-policy";
import type { CourseGrades, GradesRecord } from "./ports";
import type { ScholarshipForecast } from "./scholarship";

interface LegacyScholarshipOutlook {
  state:
    | "retained"
    | "at-risk"
    | "unreachable"
    | "debt"
    | "clarification"
    | "eligible";
  label: string;
  headline: string;
}

function describeScholarship(
  forecast: PolicyForecast,
  current: GradesRecord["scholarship"],
  debt: { title: string } | undefined,
): LegacyScholarshipOutlook {
  const currentTitle =
    current === "increased"
      ? "Повышенная стипендия"
      : "Академическая стипендия";
  if (debt)
    return {
      state: "debt",
      label: "Нужно закрыть долг",
      headline: `${current === "none" ? "Пока без стипендии" : `${currentTitle} под угрозой`}: есть долг по дисциплине «${debt.title}».`,
    };
  if (forecast.status === "clarification")
    return {
      state: "clarification",
      label: "Требует уточнения",
      headline: "Прогноз стипендии требует уточнения.",
    };
  const requirements =
    forecast.next?.courses.flatMap((course) =>
      course.requirements.map((work) => ({ ...work, course: course.title })),
    ) ?? [];
  const first = requirements.find((work) => work.minimum > 0);
  const hint = first
    ? `нужно не меньше ${first.minimum} из ${first.maxScore} за «${first.title}» по дисциплине «${first.course}»${requirements.length > 1 ? "; остальные условия — ниже" : ""}`
    : "проверьте оставшиеся работы";
  const retainsCurrent =
    current !== "none" &&
    (forecast.level === "increased" ||
      (current === "academic" && forecast.level === "academic"));
  const increasedOutlook =
    forecast.level === "increased"
      ? "Повышенная достижима по итогам семестра."
      : forecast.next?.reachable
        ? `Для повышенной ${hint}.`
        : "Повышенная недостижима в этом семестре.";
  if (retainsCurrent)
    return {
      state: "retained",
      label: "Сохраняется",
      headline: `${currentTitle} сохраняется.${current === "academic" ? ` ${increasedOutlook}` : ""}`,
    };
  if (current === "none" && forecast.level !== "none")
    return {
      state: "eligible",
      label: "Достижима",
      headline: `Пока без стипендии. ${forecast.level === "academic" ? "Академическая достижима. " : ""}${increasedOutlook}`,
    };
  const goalTitle =
    forecast.next?.level === "increased"
      ? "Повышенная стипендия"
      : "Академическая стипендия";
  if (forecast.next?.reachable === false)
    return {
      state: "unreachable",
      label: "Недостижима в этом семестре",
      headline: `${current === "none" ? "Пока без стипендии. " : ""}${goalTitle} недостижима в этом семестре.`,
    };
  return {
    state: "at-risk",
    label: "Под угрозой",
    headline:
      current === "none"
        ? `Пока без стипендии: для академической ${hint}.`
        : `${currentTitle} под угрозой: ${hint}.`,
  };
}

// Keep the Russian Today contract until its own lane moves to message DTOs.
export function legacyScholarship(
  courses: readonly (CourseGrades & { openDebts: number })[],
  scholarship: ScholarshipForecast,
) {
  const forecast = scholarshipPolicy(
    courses.map((course) => ({
      ...course,
      hasDebt: course.openDebts > 0,
    })),
    scholarship.currentScholarship,
  );
  return {
    ...scholarship,
    blockers: scholarship.blockers.map((blocker, index) => ({
      ...blocker,
      reason: forecast.blockers[index]?.reason ?? "",
    })),
    currentScholarship: scholarship.currentScholarship,
    outlook: {
      ...scholarship.outlook,
      ...describeScholarship(
        forecast,
        scholarship.currentScholarship,
        courses.find((course) => course.openDebts > 0),
      ),
    },
  };
}
