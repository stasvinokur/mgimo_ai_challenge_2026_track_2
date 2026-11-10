"use client";

import Link from "next/link";
import type { GetMyAttendance } from "@/application/attendance/student";
import { attendanceMessages } from "@/ui/i18n/dictionaries/attendance";
import { formatNumber } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";

export function StudentAttendance({
  data,
}: {
  data: Awaited<ReturnType<GetMyAttendance["execute"]>>;
}) {
  const language = useLanguage();
  const text = (key: keyof typeof attendanceMessages, params = {}) =>
    t(language, attendanceMessages, key, params);
  const number = (value: number) => formatNumber(language, value);
  const markedCourses = data.courses.filter(
    (course) => course.total > 0 || course.excused > 0,
  );
  const hasUnmarkedCourses = markedCourses.length < data.courses.length;
  return (
    <section
      id="attendance"
      className="grid gap-4"
      aria-labelledby="attendance-title"
    >
      <h2 id="attendance-title" className="text-xl font-semibold">
        {text("summaryTitle")}
      </h2>
      <Card>
        <CardHeader>
          <h3 className="font-semibold">{text("activityTitle")}</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-2xl font-semibold tabular-nums">
            {number(data.activityPoints)}{" "}
            <span className="text-base font-normal">
              {text("activityGoal", { goal: number(data.goal) })}
            </span>
          </p>
          <p>{text("activityExplanation")}</p>
          <Link
            className="inline-flex min-h-11 items-center text-primary underline"
            href="/regulations/attendance#p-5"
          >
            {text("why")}
          </Link>
        </CardContent>
      </Card>
      {markedCourses.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {markedCourses.map((course) => (
            <li key={course.id}>
              <Card className="h-full">
                <CardHeader>
                  <h3 className="font-semibold">{course.title}</h3>
                </CardHeader>
                <CardContent className="space-y-2">
                  {course.total > 0 ? (
                    <p>
                      {text("presentTotal", {
                        present: number(course.present),
                        total: number(course.total),
                      })}
                      {course.percent === null
                        ? ""
                        : ` · ${number(course.percent)}%`}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {text("excusedOnly")}
                    </p>
                  )}
                  {course.excused > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {text("excused", { count: number(course.excused) })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {hasUnmarkedCourses && (
        <p className="text-muted-foreground">{text("unmarked")}</p>
      )}
      {data.courses.length === 0 && (
        <p className="text-muted-foreground">{text("empty")}</p>
      )}
    </section>
  );
}
