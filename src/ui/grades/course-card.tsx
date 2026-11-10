"use client";

import Link from "next/link";
import type { CourseActionsDto } from "@/application/grades/get-course-actions";
import type {
  CourseGradesDto,
  GradesMessagesDto,
} from "@/application/grades/get-my-grades";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import type { Language } from "@/ui/i18n/language";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { CourseActions } from "./course-actions";
import { formatGradeDate, formatScore, gradeLabel } from "./format";
import { GradingExplanation } from "./grading-explanation";
import { WhatIf } from "./what-if";

function lightText(course: CourseGradesDto, language: Language) {
  const { code, hasPendingWorks } = course.light;
  return {
    label: t(language, gradesMessages, `light_${code}`),
    reason: t(language, gradesMessages, `lightReason_${code}`),
    action: t(
      language,
      gradesMessages,
      code === "good"
        ? hasPendingWorks
          ? "lightAction_goodPending"
          : "lightAction_goodComplete"
        : `lightAction_${code}`,
    ),
  };
}

function CourseScores({ course }: { course: CourseGradesDto }) {
  const language = useLanguage();
  if (course.calculationStatus !== "ready") return null;
  return (
    <dl className="grid grid-cols-2 gap-3">
      <div>
        <dt className="text-xs text-muted-foreground">
          {t(language, gradesMessages, "currentScore")}
        </dt>
        <dd className="text-xl font-semibold">
          {formatScore(course.currentScore, language)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">
          {t(language, gradesMessages, "securedScore")}
        </dt>
        <dd className="text-xl font-semibold">
          {formatScore(course.secured, language)}
        </dd>
      </div>
    </dl>
  );
}

export function CourseCard({ course }: { course: CourseGradesDto }) {
  const language = useLanguage();
  const light = lightText(course, language);
  const nextWork = course.works
    .filter((work) => work.status !== "graded")
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))[0];
  return (
    <Card
      className="min-w-0 gap-3 py-4 [overflow-wrap:normal]"
      data-testid="grade-course"
    >
      <CardHeader className="gap-2 px-4">
        <CardTitle>
          <h2 className="leading-snug">{course.title}</h2>
        </CardTitle>
        <div>
          <StatusBadge tone={course.light.tone}>{light.label}</StatusBadge>
          <Button asChild variant="link">
            <Link href="/regulations/assessment#p-4">
              {t(language, gradesMessages, "why")}
              <span className="sr-only">
                {t(language, gradesMessages, "indicatorCourse", {
                  course: course.title,
                })}
              </span>
            </Link>
          </Button>
        </div>
        <p className="text-sm">
          {light.reason}{" "}
          <span className="text-muted-foreground">{light.action}</span>
        </p>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <CourseScores course={course} />
        {nextWork && (
          <p className="text-xs text-muted-foreground">
            {t(
              language,
              gradesMessages,
              nextWork.status === "overdue" ? "overdue" : "nextDeadline",
            )}
            :{" "}
            <time dateTime={nextWork.dueAt}>
              {formatGradeDate(nextWork.dueAt, language)}
            </time>{" "}
            {t(language, gradesMessages, "moscow")}
          </p>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={`/grades/${course.id}`}>
            {t(language, gradesMessages, "details")}
            <span className="sr-only">
              {t(language, gradesMessages, "aboutCourse", {
                course: course.title,
              })}
            </span>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function CourseDetails({
  course,
  target,
  semester,
  plan,
  expandedActions = false,
}: {
  course: CourseGradesDto;
  target: number;
  semester?: Pick<GradesMessagesDto, "courses" | "scholarship">;
  plan?: CourseActionsDto | null;
  expandedActions?: boolean;
}) {
  const language = useLanguage();
  const light = lightText(course, language);
  return (
    <Card className="min-w-0 [overflow-wrap:normal]" data-testid="grade-course">
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <StatusBadge tone={course.light.tone}>{light.label}</StatusBadge>
          <Button asChild variant="link">
            <Link href="/regulations/assessment#p-4">
              {t(language, gradesMessages, "why")}
              <span className="sr-only">
                {t(language, gradesMessages, "indicatorCourse", {
                  course: course.title,
                })}
              </span>
            </Link>
          </Button>
          <p className="text-sm">{light.reason}</p>
          <p className="text-sm text-muted-foreground">{light.action}</p>
        </div>
        {plan && <CourseActions plan={plan} expanded={expandedActions} />}
        {course.calculationStatus === "ready" && (
          <>
            <CourseScores course={course} />
            <p className="text-sm">
              {t(language, gradesMessages, "securedGrade", {
                grade: gradeLabel(course.grade, language),
                target: formatScore(target, language),
              })}
            </p>
            <WhatIf course={course} target={target} semester={semester} />
            <section
              className="space-y-3"
              aria-label={t(language, gradesMessages, "worksDeadlines")}
            >
              <h2>{t(language, gradesMessages, "worksDeadlines")}</h2>
              <ul className="space-y-3">
                {course.works.map((work) => (
                  <li
                    key={work.id}
                    className="space-y-1 border-t border-border pt-3 text-sm"
                  >
                    <p className="font-medium">{work.title}</p>
                    <p>
                      {work.status === "graded"
                        ? t(language, gradesMessages, "submittedScore", {
                            score: formatScore(work.score, language),
                            max: formatScore(work.maxScore, language),
                          })
                        : work.status === "overdue"
                          ? t(language, gradesMessages, "overdueWork")
                          : t(language, gradesMessages, "upcomingWork")}
                    </p>
                    <p className="text-muted-foreground">
                      {t(language, gradesMessages, "weight", {
                        weight: formatScore(work.weight, language),
                      })}{" "}
                      ·{" "}
                      {t(
                        language,
                        gradesMessages,
                        work.isRequired ? "required" : "optional",
                      )}{" "}
                      · {t(language, gradesMessages, "due")}{" "}
                      <time dateTime={work.dueAt}>
                        {formatGradeDate(work.dueAt, language)}
                      </time>{" "}
                      {t(language, gradesMessages, "moscow")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        <section
          className="space-y-2"
          aria-label={t(language, gradesMessages, "exams")}
        >
          <h2>{t(language, gradesMessages, "exams")}</h2>
          {course.exams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(language, gradesMessages, "noExamDates")}
            </p>
          ) : (
            course.exams.map((exam) => (
              <p key={exam.id} className="text-sm">
                {t(
                  language,
                  gradesMessages,
                  exam.kind === "exam" ? "exam" : "creditAssessment",
                )}{" "}
                ·{" "}
                <time dateTime={exam.at}>
                  {formatGradeDate(exam.at, language)}
                </time>{" "}
                {t(language, gradesMessages, "moscow")} · {exam.room}
                {exam.kind === "credit" && course.grade
                  ? t(language, gradesMessages, "creditByScore", {
                      credit: t(
                        language,
                        gradesMessages,
                        course.grade.credit ? "creditPass" : "creditPending",
                      ),
                    })
                  : ""}
              </p>
            ))
          )}
        </section>
        <GradingExplanation />
      </CardContent>
    </Card>
  );
}
