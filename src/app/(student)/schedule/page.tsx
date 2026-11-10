import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { parseScheduleQuery } from "@/application/schedule/schemas";
import { ValidationError } from "@/application/shared/errors";
import { schedule } from "@/composition/container";
import { scheduleMessages } from "@/ui/i18n/dictionaries/schedule";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { CalendarSubscription } from "@/ui/schedule/calendar-subscription";
import { LiveRefresh } from "@/ui/schedule/live-refresh";
import { ScheduleView } from "@/ui/schedule/schedule-view";
import { renewCalendar } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), scheduleMessages, "title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStudent();
  const language = await getLanguage();
  try {
    const query = parseScheduleQuery(await searchParams);
    const [week, today] = await Promise.all([
      schedule.getWeek.execute(actor, query),
      schedule.getToday.execute(actor),
    ]);
    return (
      <div className="space-y-6">
        <LiveRefresh />
        <ScheduleView
          language={language}
          week={week}
          today={today}
          view={query.view ?? (query.week ? "week" : "today")}
        />
        <CalendarSubscription action={renewCalendar} />
      </div>
    );
  } catch (error) {
    if (error instanceof ValidationError)
      return (
        <div className="space-y-4 [overflow-wrap:normal] [word-break:normal]">
          <h1 className="text-2xl font-semibold">
            {t(language, scheduleMessages, "title")}
          </h1>
          <p role="alert">{t(language, scheduleMessages, "invalidWeek")}</p>
          <Button asChild>
            <Link href="/schedule">
              {t(language, scheduleMessages, "goToToday")}
            </Link>
          </Button>
        </div>
      );
    mapPageError(error);
  }
}
