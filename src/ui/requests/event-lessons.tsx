"use client";

import Link from "next/link";
import type { EventReleaseReview } from "@/application/requests/event-release";
import {
  EVENT_RELEASE_REGULATION,
  type EventReleaseBasis,
} from "@/application/requests/event-release-basis";
import {
  EVENT_RELEASE_TYPE,
  savedEventLessons,
} from "@/application/requests/schemas";

import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { formatDate } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";

export function EventLessonList({
  payload,
  typeCode,
  review,
  ...audience
}: {
  payload: Record<string, unknown>;
  typeCode: string;
  review?: EventReleaseReview;
} & (
  | { audience: "student" }
  | { audience: "staff"; basis: EventReleaseBasis | null }
)) {
  const deviceLanguage = useLanguage();
  const language = audience.audience === "staff" ? "ru" : deviceLanguage;
  const tr = (key: keyof typeof requestsMessages) =>
    t(language, requestsMessages, key);
  if (
    typeCode !== EVENT_RELEASE_TYPE ||
    (!review && !Array.isArray(payload.eventLessons))
  )
    return null;
  const lessons = review?.lessons ?? savedEventLessons(payload);
  return (
    <section className="min-w-0 space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">{tr("eventLessons")}</h3>
      {review?.past && (
        <p className="font-medium text-[var(--warning-ink)]">
          {tr("eventPast")}
        </p>
      )}
      {review?.changed && (
        <p className="font-medium text-[var(--warning-ink)]">
          {tr("eventChanged")}
        </p>
      )}
      {review && (
        <p className="text-sm text-muted-foreground">{tr("currentLessons")}</p>
      )}
      {lessons.length ? (
        <ul className="space-y-3">
          {lessons.map((lesson) => (
            <li
              key={`${lesson.slotId}:${lesson.occurrenceDate}`}
              className="min-w-0 text-sm"
            >
              <p className="font-medium">{lesson.course}</p>
              <p className="text-muted-foreground">
                <time dateTime={lesson.startsAt}>
                  {formatDate(language, lesson.startsAt, {
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>{" "}
                {tr("moscow")} · {lesson.room}
              </p>
              {"attendanceStatus" in lesson && (
                <p className="text-sm">
                  {tr("attendanceNow")}{" "}
                  {tr(
                    lesson.attendanceStatus === "present"
                      ? "present"
                      : lesson.attendanceStatus === "excused"
                        ? "excused"
                        : lesson.attendanceStatus === "absent"
                          ? "absent"
                          : "unmarked",
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">{tr("noEventLessons")}</p>
      )}
      <p className="text-sm text-muted-foreground">{tr("eventApproval")}</p>
      {audience.audience === "student" ? (
        <div>
          <Link
            className="inline-flex min-h-11 items-center text-sm text-primary underline"
            href={EVENT_RELEASE_REGULATION.href}
          >
            {tr("why")}
          </Link>
          {language === "en" && (
            <p className="text-sm text-muted-foreground">
              {tr("russianRegulation")}
            </p>
          )}
        </div>
      ) : (
        audience.basis && (
          <p className="text-sm text-muted-foreground">
            Основание: пункт {audience.basis.section} «{audience.basis.title}»
            положения о посещаемости
          </p>
        )
      )}
    </section>
  );
}
