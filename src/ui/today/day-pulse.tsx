"use client";

import { MapPin, UserRound } from "lucide-react";
import Link from "next/link";
import {
  scheduleDates,
  type TodayScheduleDto,
} from "@/application/schedule/get-schedule";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";
import { DayTimeline } from "@/ui/primitives/day-timeline";
import { Countdown } from "./countdown";
import { dayTimeline, todayDate, todayTime } from "./format";
import { useTodayNow } from "./use-now";

export function DayPulse({ data }: { data: TodayScheduleDto }) {
  const language = useLanguage();
  const now = useTodayNow(data.now);
  const lesson = data.current ?? data.next;
  const timeline = dayTimeline(data);
  const hasLessons = data.lessons.some(
    (item) => item.status === "scheduled" || item.status === "moved-to",
  );
  return (
    <Card variant="hero" className="min-w-0 gap-4 py-5" data-testid="day-pulse">
      <CardContent className="space-y-5 px-5 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-pulse-muted">
          <h2 className="uppercase tracking-wide">
            {t(language, todayMessages, "pulse")}
          </h2>
          <div className="flex items-center gap-2 rounded-full bg-pulse-now px-3 py-1 text-pulse-now-ink">
            <h3>{t(language, todayMessages, "now")}</h3>
            <time dateTime={now} data-testid="pulse-now">
              {todayTime(now, language)}
            </time>
          </div>
        </div>
        <p
          className="day-pulse-heading text-display font-extrabold leading-none tracking-tight"
          data-testid="pulse-state"
        >
          {!hasLessons
            ? t(language, todayMessages, "noClasses")
            : data.current
              ? t(language, todayMessages, "ongoing")
              : data.next?.date !== data.date
                ? t(language, todayMessages, "classesEnded")
                : lesson && (
                    <Countdown
                      key={lesson.startsAt}
                      startsAt={lesson.startsAt}
                      initialNow={data.now}
                    />
                  )}
        </p>
        <div className="flex flex-col items-start gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            {!hasLessons && (
              <p className="text-sm text-pulse-muted">
                {data.nextStudyDate
                  ? t(language, todayMessages, "nextStudyDate", {
                      date: todayDate(data.nextStudyDate, false, language),
                    })
                  : t(language, todayMessages, "rest")}
              </p>
            )}
            {hasLessons && !data.current && data.next?.date !== data.date && (
              <p className="text-sm text-pulse-muted">
                {t(language, todayMessages, "planTomorrow")}
              </p>
            )}
            {lesson && (
              <>
                {!data.current && lesson.date !== data.date && (
                  <p className="text-sm text-pulse-muted">
                    <Countdown
                      startsAt={lesson.startsAt}
                      initialNow={data.now}
                    />
                  </p>
                )}
                <p className="text-sm text-pulse-muted">
                  {data.current
                    ? t(language, todayMessages, "currentClass")
                    : lesson.date === data.date
                      ? t(language, todayMessages, "nextClass")
                      : t(language, todayMessages, "upcomingClass")}
                </p>
                <h3 className="text-xl font-semibold leading-snug">
                  {lesson.course} ·{" "}
                  {lesson.date !== data.date &&
                    `${todayDate(lesson.date, false, language)} · `}
                  <time dateTime={lesson.startsAt}>
                    {todayTime(lesson.startsAt, language)}
                  </time>
                  –
                  <time dateTime={lesson.endsAt}>
                    {todayTime(lesson.endsAt, language)}
                  </time>
                </h3>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-pulse-muted">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-4 shrink-0" aria-hidden="true" />
                    {t(language, todayMessages, "room", { room: lesson.room })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="size-4 shrink-0" aria-hidden="true" />
                    {lesson.teacher}
                  </span>
                  <span>{t(language, todayMessages, "moscow")}</span>
                </p>
              </>
            )}
          </div>
          <Button
            asChild
            variant="secondary"
            className="h-auto max-w-full whitespace-normal bg-pulse-foreground py-3 text-pulse hover:bg-pulse-muted"
          >
            <Link
              href={
                !hasLessons && data.nextStudyDate
                  ? `/schedule?view=week&week=${scheduleDates.isoWeek(data.nextStudyDate)}`
                  : "/schedule"
              }
            >
              {!hasLessons && data.nextStudyDate
                ? t(language, todayMessages, "nextStudyDay")
                : t(language, todayMessages, "openSchedule")}
            </Link>
          </Button>
        </div>
        <div aria-hidden="true">
          <DayTimeline {...timeline} now={Date.parse(now)} />
        </div>
        <p className="sr-only">
          {t(language, todayMessages, "timelineRange", {
            start: todayTime(
              new Date(timeline.dayStart).toISOString(),
              language,
            ),
            end: todayTime(new Date(timeline.dayEnd).toISOString(), language),
          })}{" "}
          {timeline.intervals.length
            ? timeline.intervals
                .map(
                  (item) =>
                    `${todayTime(new Date(item.start).toISOString(), language)}–${todayTime(new Date(item.end).toISOString(), language)} — ${item.title}.`,
                )
                .join(" ")
            : t(language, todayMessages, "timelineEmpty")}{" "}
          {t(language, todayMessages, "timelineNow", {
            time: todayTime(now, language),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
