import Link from "next/link";
import type { WeekScheduleDto } from "@/application/schedule/get-schedule";
import type { Source } from "@/application/today/get-today";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { formatDate } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { todayDate, todayTime } from "./format";
import { SourceError } from "./source-error";
import "./today.css";

export function WeekOverview({
  source,
  language = "ru",
}: {
  source: Source<WeekScheduleDto>;
  language?: Language;
}) {
  const week = source.ok ? source.data : null;
  const days = week?.days.slice(0, 6) ?? [];
  return (
    <Card
      className="hidden min-w-0 gap-4 rounded-feature py-4 lg:flex"
      data-testid="today-week"
    >
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-4">
        <h2 className="text-lg font-semibold">
          {t(language, todayMessages, "week")}
          {days[0] && days[5]
            ? ` · ${todayDate(days[0].date, false, language)} — ${todayDate(days[5].date, false, language)}`
            : ""}
        </h2>
        {week && (
          <Button asChild variant="link" className="px-0">
            <Link href={`/schedule?view=week&week=${week.week}`}>
              {t(language, todayMessages, "wholeWeek")}
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {!week ? (
          <SourceError name={t(language, todayMessages, "week")} />
        ) : (
          <ol className="grid min-w-0 grid-cols-3 gap-1.5 xl:grid-cols-6">
            {days.map((day) => (
              <li
                key={day.date}
                data-testid="today-week-day"
                aria-current={day.date === week.today ? "date" : undefined}
                className={`today-week-day min-w-0 space-y-2 rounded-lg p-1 text-xs ${day.date === week.today ? "bg-secondary ring-1 ring-primary" : ""}`}
              >
                <h3
                  className={`font-semibold ${day.date === week.today ? "text-primary" : "text-muted-foreground"}`}
                >
                  <time dateTime={day.date}>
                    {formatDate(language, `${day.date}T12:00:00+03:00`, {
                      weekday: "short",
                      day: "numeric",
                    })}
                  </time>
                  {day.date === week.today && (
                    <span className="block">
                      {t(language, todayMessages, "todayLower")}
                    </span>
                  )}
                </h3>
                {day.lessons.map((lesson) => {
                  const inactive =
                    lesson.status === "moved-from" ||
                    lesson.status === "cancelled";
                  const content = (
                    <>
                      <span
                        className="block whitespace-nowrap font-bold"
                        data-testid="today-week-lesson-time"
                      >
                        {todayTime(lesson.startsAt, language)}
                      </span>
                      {lesson.course}
                      <span className="block">
                        {t(language, todayMessages, "roomShort")}{" "}
                        <span
                          className="inline-block whitespace-nowrap"
                          data-testid="today-week-room"
                        >
                          {lesson.room}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <div
                      key={`${lesson.id}:${lesson.status}`}
                      className={`rounded-lg p-2 ${lesson.changes.length ? "bg-[var(--warning-bg)] text-[var(--warning-ink)]" : "bg-muted"}`}
                    >
                      {inactive ? <s>{content}</s> : content}
                      {lesson.changes.length > 0 && (
                        <p className="mt-1 font-medium">
                          {lesson.changes
                            .map(
                              (change) =>
                                ({
                                  moved: t(language, todayMessages, "moved"),
                                  room: t(
                                    language,
                                    todayMessages,
                                    "roomChange",
                                  ),
                                  cancelled: t(
                                    language,
                                    todayMessages,
                                    "cancelled",
                                  ),
                                  replaced: t(
                                    language,
                                    todayMessages,
                                    "replaced",
                                  ),
                                })[change.kind],
                            )
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                })}
                {!day.lessons.some(
                  (lesson) =>
                    lesson.status === "scheduled" ||
                    lesson.status === "moved-to",
                ) && (
                  <p className="rounded-lg border border-dashed border-border p-2 text-muted-foreground">
                    {t(language, todayMessages, "freeDay")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
