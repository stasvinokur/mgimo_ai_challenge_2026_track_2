import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type {
  Lesson,
  LessonChange,
  LessonTime,
  TodayScheduleDto,
  WeekScheduleDto,
} from "@/application/schedule/get-schedule";
import { scheduleDates } from "@/application/schedule/get-schedule";
import { scheduleMessages } from "@/ui/i18n/dictionaries/schedule";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { StatusBadge } from "@/ui/primitives/status-badge";

function time(language: Language, iso: string): string {
  return formatDate(language, iso, { hour: "2-digit", minute: "2-digit" });
}

function dateLabel(language: Language, date: string): string {
  const label = formatDate(language, `${date}T12:00:00+03:00`, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toLocaleUpperCase(language) + label.slice(1);
}

function momentLabel(language: Language, value: LessonTime): string {
  return t(language, scheduleMessages, "moment", {
    date: formatDate(language, value.startsAt, {
      day: "numeric",
      month: "short",
    }),
    start: time(language, value.startsAt),
    end: time(language, value.endsAt),
    room: value.room,
  });
}

function ChangeDetail({
  change,
  status,
  language,
}: {
  change: LessonChange;
  status: Lesson["status"];
  language: Language;
}) {
  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-muted p-3 text-sm"
      data-testid="schedule-change"
    >
      <StatusBadge tone={change.kind === "cancelled" ? "danger" : "warning"}>
        {t(language, scheduleMessages, change.kind)}
      </StatusBadge>
      {change.kind === "moved" && (
        <>
          <p>
            {status === "moved-from"
              ? t(language, scheduleMessages, "movedTo", {
                  moment: momentLabel(language, change.after),
                })
              : t(language, scheduleMessages, "movedFrom", {
                  moment: momentLabel(language, change.before),
                })}
          </p>
          <p>
            <span className="sr-only">
              {t(language, scheduleMessages, "before")}
            </span>
            {momentLabel(language, change.before)}{" "}
            <span aria-hidden="true">→</span>
            <span className="sr-only">
              {t(language, scheduleMessages, "after")}
            </span>{" "}
            {momentLabel(language, change.after)}
          </p>
        </>
      )}
      {change.kind === "room" && (
        <p>
          {t(language, scheduleMessages, "roomLabel", {
            room: change.before.room,
          })}{" "}
          → {change.after.room}
        </p>
      )}
      {change.kind === "replaced" && (
        <p>
          {change.before.teacher} → {change.after.teacher}
        </p>
      )}
      {change.kind === "cancelled" && (
        <p>
          {time(language, change.before.startsAt)}–
          {time(language, change.before.endsAt)} →{" "}
          {t(language, scheduleMessages, "cancellation")}
        </p>
      )}
      <p className="text-muted-foreground">
        {t(language, scheduleMessages, "reason", { reason: change.reason })}
      </p>
    </div>
  );
}

function LessonCard({
  lesson,
  now,
  today,
  language,
}: {
  lesson: Lesson;
  now: string;
  today: string;
  language: Language;
}) {
  const inactive =
    lesson.status === "moved-from" || lesson.status === "cancelled";
  const current =
    !inactive &&
    lesson.date === today &&
    lesson.startsAt <= now &&
    lesson.endsAt > now;
  const minutes =
    !inactive && lesson.date === today && lesson.startsAt > now
      ? Math.ceil((Date.parse(lesson.startsAt) - Date.parse(now)) / 60_000)
      : null;
  const period = (
    <>
      <time dateTime={lesson.startsAt}>{time(language, lesson.startsAt)}</time>–
      <time dateTime={lesson.endsAt}>{time(language, lesson.endsAt)}</time>
    </>
  );
  return (
    <li
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      data-testid="schedule-lesson"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold tabular-nums">
          {inactive ? <s>{period}</s> : period}
        </p>
        <span className="text-sm text-muted-foreground">
          {t(language, scheduleMessages, lesson.kind)}
        </span>
        {current && (
          <StatusBadge tone="success">
            {t(language, scheduleMessages, "inProgress")}
          </StatusBadge>
        )}
        {minutes !== null && (
          <StatusBadge tone="info">
            {t(language, scheduleMessages, "inMinutes", {
              minutes: formatNumber(language, minutes),
            })}
          </StatusBadge>
        )}
      </div>
      <h3 className="text-base font-semibold">
        {inactive ? <s>{lesson.course}</s> : lesson.course}
      </h3>
      <p className="flex items-start gap-2 text-sm">
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        {t(language, scheduleMessages, "roomLabel", { room: lesson.room })}
      </p>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <UserRound className="size-4 shrink-0" aria-hidden="true" />
        {lesson.teacher}
      </p>
      {lesson.changes.map((change) => (
        <ChangeDetail
          key={change.id}
          change={change}
          status={lesson.status}
          language={language}
        />
      ))}
    </li>
  );
}

export function ScheduleView({
  week,
  today,
  view,
  language = "ru",
}: {
  week: WeekScheduleDto;
  today: TodayScheduleDto;
  view: "today" | "week";
  language?: Language;
}) {
  const days =
    view === "today"
      ? [{ date: today.date, lessons: today.lessons }]
      : week.days;
  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:normal] [word-break:normal]">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t(language, scheduleMessages, "studyWeek", { group: week.group })}
        </p>
        <h1 className="text-2xl font-semibold">
          {t(language, scheduleMessages, "title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(language, scheduleMessages, "introduction")}
        </p>
      </header>
      <nav
        aria-label={t(language, scheduleMessages, "view")}
        className="flex flex-wrap gap-2"
      >
        <Button asChild variant={view === "today" ? "default" : "outline"}>
          <Link
            href="/schedule?view=today"
            aria-current={view === "today" ? "page" : undefined}
          >
            {t(language, scheduleMessages, "today")}
          </Link>
        </Button>
        <Button asChild variant={view === "week" ? "default" : "outline"}>
          <Link
            href={`/schedule?view=week&week=${week.week}`}
            aria-current={view === "week" ? "page" : undefined}
          >
            {t(language, scheduleMessages, "week")}
          </Link>
        </Button>
      </nav>
      {view === "week" && (
        <div className="space-y-3">
          <nav
            aria-label={t(language, scheduleMessages, "selectWeek")}
            className="flex items-center justify-between gap-2"
          >
            <Button asChild variant="outline" size="icon">
              <Link
                aria-label={t(language, scheduleMessages, "previousWeek")}
                href={`/schedule?view=week&week=${week.previousWeek}`}
              >
                <ChevronLeft aria-hidden="true" />
              </Link>
            </Button>
            <p className="text-center text-sm font-medium">
              {week.week}
              <br />
              {dateLabel(language, week.days[0]?.date ?? today.date)}
            </p>
            <Button asChild variant="outline" size="icon">
              <Link
                aria-label={t(language, scheduleMessages, "nextWeek")}
                href={`/schedule?view=week&week=${week.nextWeek}`}
              >
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          </nav>
          <Button asChild variant="ghost">
            <Link href={`/schedule?view=week&week=${week.currentWeek}`}>
              {t(language, scheduleMessages, "currentWeek")}
            </Link>
          </Button>
        </div>
      )}
      {view === "today" && (
        <Card>
          <CardContent className="space-y-2 pt-6" aria-live="polite">
            {today.current && (
              <p className="font-medium">
                {t(language, scheduleMessages, "currentClass", {
                  course: today.current.course,
                  end: time(language, today.current.endsAt),
                })}
              </p>
            )}
            {today.next?.date === today.date && (
              <p>
                {t(language, scheduleMessages, "nextClass", {
                  minutes: formatNumber(language, today.minutesUntilNext ?? 0),
                  course: today.next.course,
                  room: today.next.room,
                })}
              </p>
            )}
            {!today.current && today.next?.date !== today.date && (
              <p>{t(language, scheduleMessages, "noMoreClasses")}</p>
            )}
            {today.changes.length > 0 && (
              <p className="text-sm font-medium">
                {t(language, scheduleMessages, "todayChanges")}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <div
        className={
          view === "week"
            ? "grid items-start gap-4 xl:grid-cols-2"
            : "space-y-4"
        }
      >
        {days.map((day) => (
          <Card key={day.date} className="min-w-0">
            <CardHeader>
              <CardTitle>
                <h2>
                  {dateLabel(language, day.date)}
                  {day.date === week.today
                    ? t(language, scheduleMessages, "todaySuffix")
                    : ""}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {day.lessons.length > 0 && (
                <ul className="space-y-3">
                  {day.lessons.map((lesson) => (
                    <LessonCard
                      key={`${lesson.id}-${lesson.status}`}
                      lesson={lesson}
                      now={week.now}
                      today={week.today}
                      language={language}
                    />
                  ))}
                </ul>
              )}
              {!day.lessons.some(
                (lesson) =>
                  lesson.status === "scheduled" || lesson.status === "moved-to",
              ) && (
                <EmptyState
                  icon={CalendarDays}
                  title={t(language, scheduleMessages, "noClasses")}
                  description={
                    today.nextStudyDate && day.date === today.date
                      ? t(language, scheduleMessages, "nextStudyDay", {
                          date: dateLabel(language, today.nextStudyDate),
                        })
                      : t(language, scheduleMessages, "restOrBrowse")
                  }
                  action={
                    <Button
                      asChild
                      variant="outline"
                      className="h-auto max-w-full whitespace-normal"
                    >
                      <Link
                        href={`/schedule?view=week&week=${today.nextStudyDate && day.date === today.date ? scheduleDates.isoWeek(today.nextStudyDate) : week.nextWeek}`}
                      >
                        {today.nextStudyDate && day.date === today.date
                          ? t(language, scheduleMessages, "goToNextStudyDay")
                          : t(language, scheduleMessages, "nextWeek")}
                      </Link>
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
