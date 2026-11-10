"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { GradesMessagesDto } from "@/application/grades/get-my-grades";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { CourseCard } from "./course-card";
import { formatScore } from "./format";
import { GradingExplanation } from "./grading-explanation";
import { ScholarshipCard } from "./scholarship-forecast";

export function GradesView({
  data,
  attendance,
}: {
  data: GradesMessagesDto;
  attendance?: ReactNode;
}) {
  const language = useLanguage();
  const text = (
    key: keyof typeof gradesMessages,
    params?: Record<string, string | number>,
  ) => t(language, gradesMessages, key, params);
  const summary = data.summary;
  const debts = data.courses.filter((course) => course.openDebts > 0);
  return (
    <div className="section-page [overflow-wrap:normal]">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{text("currentSemester")}</p>
          <h1>{text("study")}</h1>
          <p className="page-lead">{text("studyLead")}</p>
        </div>
      </div>
      <ScholarshipCard forecast={data.scholarship} />
      {data.courses.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title={text("noGrades")}
            description={text("noGradesHint")}
            action={
              <Button asChild variant="outline">
                <Link href="/schedule">{text("openSchedule")}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle>
                <h2>{text("progress")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {debts.length > 0 && (
                <p className="text-sm font-medium">
                  {text("debtsSummary", {
                    courses: debts
                      .map((course) => `«${course.title}»`)
                      .join(", "),
                  })}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                  [
                    text("averageScore"),
                    formatScore(summary.averageScore, language),
                  ],
                  [text("goodCourses"), summary.inGoodShape],
                  [text("attention"), summary.needsAttention],
                  [text("openDebts"), summary.openDebts],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 [overflow-wrap:normal]">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm">
                {text("courseTarget", {
                  target: formatScore(summary.targetScore, language),
                })}{" "}
                {text(
                  debts.length > 0
                    ? "finishRequired"
                    : summary.averageScore === null
                      ? "averagePending"
                      : summary.averageScore >= summary.targetScore
                        ? "averageReaches"
                        : "averageBelow",
                )}
              </p>
              <GradingExplanation />
            </CardContent>
          </Card>
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
            {data.courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        </>
      )}
      {attendance}
    </div>
  );
}
