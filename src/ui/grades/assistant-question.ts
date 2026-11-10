import type { CourseActionsDto } from "@/application/grades/get-course-actions";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { formatDate } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { formatScore } from "./format";

export function getCourseAssistantQuestion(
  plan: Pick<CourseActionsDto, "courseTitle" | "assistantContext">,
  language: Language,
) {
  const context = plan.assistantContext;
  const workFacts =
    context.workTitle !== null && context.dueAt !== null
      ? t(language, gradesMessages, "assistantWorkFacts", {
          work: context.workTitle,
          date: formatDate(language, context.dueAt, {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          overdue: context.overdue
            ? t(language, gradesMessages, "assistantOverdue")
            : "",
        })
      : t(language, gradesMessages, "assistantAllGraded");
  const scoreFacts = t(language, gradesMessages, "assistantScoreFacts", {
    total: formatScore(context.total, language),
    target: formatScore(context.target, language),
  });
  return t(language, gradesMessages, "assistantQuestion", {
    course: plan.courseTitle,
    facts: `${workFacts}\n${scoreFacts}`,
  });
}
