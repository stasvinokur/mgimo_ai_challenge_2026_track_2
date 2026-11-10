import type {
  ScholarshipBlocker,
  ScholarshipOutlook,
} from "@/application/grades/scholarship";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { formatScore, gradeLabel } from "./format";

export function scholarshipMessage(
  outlook: ScholarshipOutlook,
  language: Language,
) {
  const tr = (
    key: keyof typeof gradesMessages,
    params: Record<string, string | number> = {},
  ) => t(language, gradesMessages, key, params);
  const title = (level: "academic" | "increased") =>
    tr(level === "increased" ? "increasedScholarship" : "academicScholarship");
  const currentTitle = title(
    outlook.currentScholarship === "increased" ? "increased" : "academic",
  );
  const none = tr("scholarshipNone");
  const hint = outlook.requirement
    ? tr("scholarshipRequirement", {
        minimum: formatScore(outlook.requirement.minimum, language),
        max: formatScore(outlook.requirement.maxScore, language),
        title: outlook.requirement.title,
        course: outlook.requirement.course,
      }) +
      (outlook.requirement.hasMore ? tr("scholarshipMoreRequirements") : "")
    : tr("scholarshipCheckWork");
  const increased =
    outlook.increasedOutlook === "eligible"
      ? tr("scholarshipIncreasedEligible")
      : outlook.increasedOutlook === "reachable"
        ? tr("scholarshipIncreasedRequirement", { hint })
        : tr("scholarshipIncreasedUnreachable");
  const labels = {
    retained: "scholarshipStateRetained",
    "at-risk": "scholarshipStateAtRisk",
    unreachable: "scholarshipStateUnreachable",
    debt: "scholarshipStateDebt",
    clarification: "scholarshipStateClarification",
    eligible: "scholarshipStateEligible",
  } as const;
  let headline: string;
  switch (outlook.state) {
    case "debt":
      headline = tr("scholarshipDebt", {
        current:
          outlook.currentScholarship === "none"
            ? none
            : tr("scholarshipAtRisk", { title: currentTitle }),
        course: outlook.debtTitle ?? "",
      });
      break;
    case "clarification":
      headline = tr("scholarshipClarification");
      break;
    case "retained":
      headline = tr("scholarshipRetained", { title: currentTitle });
      if (outlook.currentScholarship === "academic")
        headline += ` ${increased}`;
      break;
    case "eligible":
      headline = `${none}. ${outlook.level === "academic" ? `${tr("scholarshipAcademicEligible")} ` : ""}${increased}`;
      break;
    case "unreachable":
      headline = `${outlook.currentScholarship === "none" ? `${none}. ` : ""}${tr("scholarshipUnreachable", { title: title(outlook.nextLevel) })}`;
      break;
    case "at-risk":
      headline =
        outlook.currentScholarship === "none"
          ? tr("scholarshipNoneAtRisk", { hint })
          : tr("scholarshipCurrentAtRisk", { title: currentTitle, hint });
      break;
  }
  return { label: tr(labels[outlook.state]), headline };
}

export function scholarshipBlockerMessage(
  blocker: ScholarshipBlocker,
  language: Language,
) {
  switch (blocker.code) {
    case "debt":
      return t(language, gradesMessages, "scholarshipBlockerDebt");
    case "clarification":
      return t(language, gradesMessages, "scholarshipBlockerClarification");
    case "below-threshold":
      return t(language, gradesMessages, "scholarshipBlockerThreshold", {
        threshold: formatScore(blocker.threshold, language),
        grade: gradeLabel(blocker.grade, language),
      });
  }
}
