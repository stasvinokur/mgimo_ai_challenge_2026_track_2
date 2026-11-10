"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CourseActionsDto } from "@/application/grades/get-course-actions";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { formatDate } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { openAssistant } from "@/ui/shell/assistant-entry";
import { getCourseAssistantQuestion } from "./assistant-question";
import { formatScore, gradeLabel } from "./format";
import { OutcomeFork } from "./outcome-fork";

export function CourseActions({
  plan,
  expanded,
}: {
  plan: CourseActionsDto;
  expanded: boolean;
}) {
  const language = useLanguage();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const text = (
    key: keyof typeof gradesMessages,
    params?: Record<string, string | number>,
  ) => t(language, gradesMessages, key, params);
  const params = new URLSearchParams({
    type: "question",
    courseId: plan.courseId,
  });
  if (plan.workId) params.set("workId", plan.workId);
  return (
    <details
      id="course-actions"
      open={expanded}
      className="min-w-0 rounded-xl border p-4 [overflow-wrap:normal]"
      data-testid="course-actions"
      data-course-actions-ready={ready}
    >
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
        {text("courseActions")}
        <span className="sr-only">
          {text("forCourse", { course: plan.courseTitle })}
        </span>
      </summary>
      <div className="space-y-4 pt-3">
        <ol className="space-y-4">
          {plan.options.map((option) => (
            <li
              key={option.workId ?? "review"}
              className="space-y-2 rounded-xl bg-secondary p-4"
            >
              <h3 className="font-semibold">
                {text(`action_${option.code}`, {
                  work: option.workTitle ?? "",
                })}
              </h3>
              <p className="text-sm">
                {text(`actionDescription_${option.code}`, {
                  date: option.dueAt
                    ? formatDate(language, option.dueAt, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {option.outcomes
                  ? text("actionEffect", {
                      score: formatScore(option.score, language),
                      max: formatScore(option.maxScore, language),
                      total: formatScore(option.total, language),
                      grade: gradeLabel(
                        option.outcomes.submitted.grade,
                        language,
                      ),
                      baseline: formatScore(option.baseline, language),
                      target: formatScore(option.target, language),
                      reached: text(
                        option.reachesTarget
                          ? "actionReached"
                          : "actionNotReached",
                      ),
                    })
                  : text("actionReviewEffect", {
                      total: formatScore(option.total, language),
                    })}
              </p>
              {option.outcomes && (
                <OutcomeFork outcomes={option.outcomes} compact />
              )}
              {option.notes.map((note) => (
                <p key={note} className="text-xs text-muted-foreground">
                  {text(`note_${note}`)}
                </p>
              ))}
            </li>
          ))}
          <li className="space-y-2 rounded-xl bg-secondary p-4">
            <h3 className="font-semibold">{text("appealTitle")}</h3>
            <p className="text-sm text-muted-foreground">
              {text("appealDescription")}
            </p>
            {language === "en" && (
              <p className="text-sm text-muted-foreground">
                {text("appealRussian")}
              </p>
            )}
            <Button
              asChild
              className="h-auto min-h-11 max-w-full whitespace-normal [overflow-wrap:normal]"
            >
              <Link href={`/requests/new?${params.toString()}`}>
                {text("prepareAppeal")}
              </Link>
            </Button>
          </li>
        </ol>
        <Button
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal [overflow-wrap:normal]"
          onClick={() =>
            openAssistant(getCourseAssistantQuestion(plan, language))
          }
        >
          {text("discussAssistant")}
        </Button>
      </div>
    </details>
  );
}
