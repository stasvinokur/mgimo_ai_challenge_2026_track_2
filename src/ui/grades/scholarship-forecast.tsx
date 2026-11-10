"use client";

import Link from "next/link";
import { useId } from "react";
import type { ScholarshipForecast } from "@/application/grades/scholarship";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { formatScore } from "./format";
import {
  scholarshipBlockerMessage,
  scholarshipMessage,
} from "./scholarship-message";

export function ScholarshipResult({
  forecast,
}: {
  forecast: ScholarshipForecast;
}) {
  const language = useLanguage();
  const prefix = useId();
  const tr = (
    key: keyof typeof gradesMessages,
    params: Record<string, string | number> = {},
  ) => t(language, gradesMessages, key, params);
  const scoreText = (value: number) => formatScore(value, language);
  const { outlook, next } = forecast;
  const message = scholarshipMessage(outlook, language);
  const courses = [
    ...new Map([
      ...forecast.blockers.map(
        (item) =>
          [item.courseId, { id: item.courseId, title: item.title }] as const,
      ),
      ...(next?.courses
        .filter(
          (course) =>
            course.requirements.length > 0 || course.reachable === false,
        )
        .map(
          (course) =>
            [
              course.courseId,
              { id: course.courseId, title: course.title },
            ] as const,
        ) ?? []),
    ]).values(),
  ];
  const requirementCount =
    next?.courses.reduce(
      (sum, course) => sum + course.requirements.length,
      0,
    ) ?? 0;
  return (
    <div
      className="space-y-3 [overflow-wrap:normal]"
      data-testid="scholarship-forecast"
    >
      <p className="font-medium" data-testid="scholarship-headline">
        {message.headline}
      </p>
      <StatusBadge
        tone={
          outlook.state === "clarification"
            ? "neutral"
            : outlook.state === "retained" || outlook.state === "eligible"
              ? "success"
              : "warning"
        }
      >
        {message.label}
      </StatusBadge>
      {outlook.state === "debt" && (
        <p className="text-sm">{tr("scholarshipDebtHelp")}</p>
      )}
      {forecast.status === "clarification" && (
        <p className="text-sm">{tr("scholarshipClarificationHelp")}</p>
      )}
      {outlook.state === "unreachable" && (
        <p className="text-sm">{tr("scholarshipUnreachableHelp")}</p>
      )}
      {courses.length > 0 && (
        <ul className="space-y-3 text-sm">
          {courses.map((course) => {
            const improvement = next?.courses.find(
              (item) => item.courseId === course.id,
            );
            return (
              <li key={course.id} className="space-y-2">
                <p className="font-medium">{course.title}</p>
                {forecast.blockers
                  .filter((item) => item.courseId === course.id)
                  .map((item) => (
                    <p key={item.code}>
                      {scholarshipBlockerMessage(item, language)}.
                    </p>
                  ))}
                {improvement?.reachable === false && (
                  <p>
                    {tr("scholarshipMaximumInsufficient", {
                      threshold: scoreText(next?.threshold ?? 0),
                    })}
                  </p>
                )}
                {requirementCount > 1 &&
                  improvement?.requirements.map((work) => (
                    <p key={work.workId}>
                      {tr("scholarshipWorkMinimum", {
                        title: work.title,
                        minimum: scoreText(work.minimum),
                        max: scoreText(work.maxScore),
                      })}
                    </p>
                  ))}
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={`/grades/${course.id}`}>
                    {tr("openCourse")}
                    <span className="sr-only"> «{course.title}»</span>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {requirementCount > 1 && (
        <p className="text-sm text-muted-foreground">
          {tr("scholarshipAllRequired")}
        </p>
      )}
      <details
        className="text-sm text-muted-foreground"
        aria-labelledby={`${prefix}-calculation`}
      >
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground">
          {tr("howCalculated")}
        </summary>
        <span id={`${prefix}-calculation`} className="sr-only">
          {tr("scholarshipCalculationLabel")}
        </span>
        <p className="pb-2">{tr("scholarshipCalculation")}</p>
      </details>
      <Button asChild variant="link" className="min-h-11 px-0">
        <Link href="/regulations/scholarship#p-2">
          {tr("why")}
          <span className="sr-only">{tr("scholarshipRules")}</span>
        </Link>
      </Button>
    </div>
  );
}

export function ScholarshipCard({
  forecast,
}: {
  forecast: ScholarshipForecast;
}) {
  const language = useLanguage();
  return (
    <Card className="min-w-0 gap-3 py-4" id="scholarship">
      <CardHeader className="px-4">
        <CardTitle>
          <h2>{t(language, gradesMessages, "scholarship")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <ScholarshipResult forecast={forecast} />
      </CardContent>
    </Card>
  );
}
