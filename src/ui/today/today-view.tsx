import { CalendarDays, CheckCheck, Clock3 } from "lucide-react";
import Link from "next/link";
import type { OnboardingDto } from "@/application/onboarding/get-onboarding";
import type { PickupBookingDto } from "@/application/requests/pickup";
import type {
  LessonTime,
  TodayScheduleDto,
  WeekScheduleDto,
} from "@/application/schedule/get-schedule";
import type { StudentProfile } from "@/application/student/ports";
import type { Source, TodayDto } from "@/application/today/get-today";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { OnboardingCard } from "@/ui/onboarding/onboarding-card";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { PickupToday } from "@/ui/requests/pickup-today";
import { actionPresentation, todayActionLabel } from "./action-label";
import { TodayAssistantCard } from "./assistant-card";
import { TodayBriefingCard } from "./briefing-card";
import { DayPulse } from "./day-pulse";
import {
  todayDate as date,
  greeting,
  requestStage,
  requestStatus,
  scholarshipHeadline,
  todayTime as time,
  todayDateHeading,
} from "./format";
import { TodayProgressRing as ProgressRing } from "./progress-ring";
import { SourceError } from "./source-error";
import { TodayStageBar as StageBar } from "./stage-bar";
import "./today.css";
import { WeekOverview } from "./week-overview";

function moment(value: LessonTime, day: string, language: Language) {
  return `${date(value.startsAt, false, language) === date(day, false, language) ? "" : `${date(value.startsAt, false, language)}, `}${time(value.startsAt, language)}–${time(value.endsAt, language)}, ${t(language, todayMessages, "roomShort").toLocaleLowerCase(language === "ru" ? "ru-RU" : "en-GB")} ${value.room}`;
}

function Changes({
  data,
  language,
}: {
  data: TodayScheduleDto;
  language: Language;
}) {
  const changes = [
    ...new Map(
      data.changes.flatMap((item) =>
        item.changes.map(
          (change) => [change.id, { course: item.course, change }] as const,
        ),
      ),
    ).values(),
  ];
  if (!changes.length) return null;
  return (
    <section
      aria-label={t(language, todayMessages, "changes")}
      className="space-y-2"
    >
      <h2 className="sr-only">{t(language, todayMessages, "changes")}</h2>
      {changes.map(({ course, change }) => (
        <div
          key={change.id}
          className="flex gap-3 rounded-feature bg-[var(--warning-bg)] p-4 text-sm text-[var(--warning-ink)]"
          data-testid="today-change"
        >
          <Clock3 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 className="font-bold">
              {course} ·{" "}
              {
                {
                  moved: t(language, todayMessages, "moved"),
                  room: t(language, todayMessages, "roomChange"),
                  cancelled: t(language, todayMessages, "cancelled"),
                  replaced: t(language, todayMessages, "replaced"),
                }[change.kind]
              }
            </h3>
            <p>
              <span className="sr-only">
                {t(language, todayMessages, "before")}
              </span>
              <s>
                {change.kind === "room"
                  ? t(language, todayMessages, "room", {
                      room: change.before.room,
                    })
                  : change.kind === "replaced"
                    ? change.before.teacher
                    : moment(change.before, data.date, language)}
              </s>{" "}
              →{" "}
              <span className="sr-only">
                {t(language, todayMessages, "after")}
              </span>
              <strong>
                {change.kind === "cancelled"
                  ? t(language, todayMessages, "classCancelled")
                  : change.kind === "room"
                    ? t(language, todayMessages, "room", {
                        room: change.after.room,
                      })
                    : change.kind === "replaced"
                      ? change.after.teacher
                      : moment(change.after, data.date, language)}
              </strong>
            </p>
            <p>
              {t(language, todayMessages, "reason", { reason: change.reason })}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}

const scholarshipTones = {
  debt: "danger",
  unreachable: "danger",
  "at-risk": "warning",
  clarification: "warning",
  retained: "success",
  eligible: "success",
} as const;

function Actions({ data, language }: { data: TodayDto; language: Language }) {
  const complete = data.study.ok && data.requests.ok && data.notifications.ok;
  return (
    <Card className="min-w-0 gap-3 rounded-feature py-4">
      <CardHeader className="px-4">
        <h2 className="text-lg font-bold">
          {t(language, todayMessages, "needsAction")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {!data.notifications.ok && (
          <SourceError name={t(language, todayMessages, "notifications")} />
        )}
        {data.actions.length ? (
          <ul className="divide-y divide-border">
            {data.actions.map((item) => {
              const presentation = actionPresentation(item, language);
              const notificationLanguage =
                language === "en" && item.message.code === "notification"
                  ? "ru"
                  : undefined;
              return (
                <li
                  key={item.id}
                  data-testid="today-action"
                  className="today-action-row flex min-w-0 flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="today-action-copy space-y-1">
                    <h3
                      className="font-semibold leading-snug"
                      lang={notificationLanguage}
                    >
                      {presentation.title}
                    </h3>
                    {notificationLanguage && (
                      <p className="text-sm text-muted-foreground">
                        {t(language, notificationsMessages, "russianContent")}
                      </p>
                    )}
                    <p
                      className="text-sm text-muted-foreground"
                      lang={notificationLanguage}
                    >
                      {presentation.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={
                          item.urgency === "overdue"
                            ? "danger"
                            : item.urgency === "today"
                              ? "warning"
                              : "info"
                        }
                      >
                        {t(language, todayMessages, item.urgency)}
                      </StatusBadge>
                      {item.dueAt && (
                        <p className="text-xs">
                          {t(language, todayMessages, "due")}{" "}
                          <time dateTime={item.dueAt}>
                            {date(item.dueAt, true, language)}
                          </time>{" "}
                          {t(language, todayMessages, "moscow")}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    asChild
                    variant={item.urgency === "today" ? "default" : "secondary"}
                    className="today-action-link h-auto px-3 py-3 text-center"
                  >
                    <Link
                      href={
                        item.section === "grades" &&
                        /^(course|work):/.test(item.id)
                          ? `${item.href}?actions=1${item.id.startsWith("work:") ? `&workId=${encodeURIComponent(item.id.slice(5))}` : ""}#course-actions`
                          : item.href
                      }
                    >
                      {item.section === "grades" &&
                      /^(course|work):/.test(item.id)
                        ? t(language, todayMessages, "options")
                        : todayActionLabel(item, language)}
                      <span className="sr-only" lang={notificationLanguage}>
                        : {presentation.title}
                      </span>
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : complete ? (
          <EmptyState
            icon={CheckCheck}
            title={t(language, todayMessages, "controlled")}
            description={t(language, todayMessages, "noUrgent")}
            action={
              <Button asChild variant="outline">
                <Link href="/schedule">
                  {t(language, todayMessages, "viewSchedule")}
                </Link>
              </Button>
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(language, todayMessages, "incomplete")}
          </p>
        )}
        {data.more.map((item) => (
          <Button
            key={item.section}
            asChild
            variant="ghost"
            className="h-auto max-w-full whitespace-normal"
          >
            <Link href={item.href}>
              {t(language, todayMessages, "more", {
                section: t(language, todayMessages, item.section),
                count: formatNumber(language, item.count),
              })}
            </Link>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function Study({
  source,
  language,
}: {
  source: TodayDto["study"];
  language: Language;
}) {
  if (!source.ok)
    return <SourceError name={t(language, todayMessages, "grades")} />;
  const { summary, scholarship, session } = source.data;
  const debt = summary.openDebts > 0;
  return (
    <Card
      className={`min-w-0 gap-3 rounded-feature py-4 ${debt ? "border-[var(--danger-ink)] bg-[var(--danger-bg)]" : ""}`}
      data-testid="today-study"
    >
      <CardHeader className="px-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t(language, todayMessages, "whatsNext")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <section
          aria-label={t(language, todayMessages, "studyAhead")}
          className="space-y-3"
        >
          <div className="flex items-start gap-3">
            {summary.averageScore !== null && (
              <ProgressRing
                language={language}
                value={summary.averageScore}
                goal={summary.targetScore}
                tone={scholarshipTones[scholarship.state]}
              />
            )}
            <div className="min-w-0 space-y-2">
              <h3
                className={`font-bold leading-snug ${debt ? "text-[var(--danger-ink)]" : ""}`}
                data-testid="scholarship-summary"
              >
                {scholarshipHeadline(scholarship, language)}
              </h3>
              {debt && (
                <p className="text-sm text-[var(--danger-ink)]">
                  {t(language, todayMessages, "debtAdvice")}
                </p>
              )}
              {summary.averageScore === null && (
                <p className="text-sm text-muted-foreground">
                  {t(language, todayMessages, "noScores")}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {t(
                  language,
                  todayMessages,
                  new Intl.PluralRules(
                    language === "ru" ? "ru-RU" : "en-GB",
                  ).select(summary.needsAttention) === "one"
                    ? "studySummaryOne"
                    : "studySummaryMany",
                  {
                    good: formatNumber(language, summary.inGoodShape),
                    attention: formatNumber(language, summary.needsAttention),
                  },
                )}
              </p>
            </div>
          </div>
          {session ? (
            <p className="text-sm">
              <CalendarDays className="mr-2 inline size-4" aria-hidden="true" />
              {session.days === 0
                ? t(language, todayMessages, "sessionToday")
                : t(language, todayMessages, "sessionDays", {
                    days: formatNumber(language, session.days),
                  })}{" "}
              ·{" "}
              <time dateTime={session.at}>
                {date(session.at, false, language)}
              </time>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(language, todayMessages, "noSession")}
            </p>
          )}
          <Button
            asChild
            variant="link"
            className="h-auto max-w-full whitespace-normal px-0"
          >
            <Link href="/grades">
              {t(language, todayMessages, "openGrades")}
            </Link>
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}

function Requests({
  source,
  pickup,
  language,
}: {
  source: TodayDto["requests"];
  pickup: Source<PickupBookingDto[]>;
  language: Language;
}) {
  if (!source.ok)
    return <SourceError name={t(language, todayMessages, "requests")} />;
  return (
    <Card
      className="hidden min-w-0 gap-3 rounded-feature py-4 lg:flex"
      data-testid="today-requests"
    >
      <CardHeader className="px-4">
        <h2 className="text-lg font-bold">
          {t(language, todayMessages, "myRequests")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {pickup.ok ? (
          <PickupToday bookings={pickup.data} />
        ) : (
          <SourceError name={t(language, todayMessages, "tickets")} />
        )}
        <section
          className="space-y-3"
          aria-label={t(language, todayMessages, "requestsAhead")}
        >
          {source.data.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(language, todayMessages, "noRequests")}
            </p>
          ) : source.data.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(language, todayMessages, "noActiveRequests")}
            </p>
          ) : (
            <ul className="space-y-3">
              {source.data.active.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/requests/${encodeURIComponent(item.id)}`}
                    className="block min-h-11 space-y-2 rounded-lg p-2 transition-colors hover:bg-accent"
                    data-testid="today-request"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-1">
                      <h3 className="font-semibold">{item.title}</h3>
                      <span className="text-sm font-medium">
                        {requestStatus(item.status, language)}
                        {item.sla
                          ? ` · ${t(language, todayMessages, ({ overdue: "slaOverdue", soon: "slaSoon", on_time: "slaOnTime" } as const)[item.sla])}`
                          : ""}
                      </span>
                    </div>
                    <StageBar
                      language={language}
                      total={5}
                      current={requestStage(item.status)}
                      tone={
                        item.sla === "overdue"
                          ? "danger"
                          : item.sla === "soon"
                            ? "warning"
                            : "success"
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {item.dueAt ? (
                        <>
                          {t(language, todayMessages, "expectedDate")}{" "}
                          <time dateTime={item.dueAt}>
                            {date(item.dueAt, false, language)}
                          </time>
                        </>
                      ) : (
                        t(language, todayMessages, "noRequestDate")
                      )}
                    </p>
                    <span className="sr-only">
                      {t(language, todayMessages, "openRequest")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="px-0">
            <Link href="/requests">
              {t(language, todayMessages, "allRequests")}
            </Link>
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}

export function TodayView({
  data,
  language = "ru",
  serverSpeech = false,
  week = { ok: false },
  profile = { ok: false },
  onboarding = { ok: true, data: null },
  pickup = { ok: true, data: [] },
}: {
  data: TodayDto;
  language?: Language;
  serverSpeech?: boolean;
  week?: Source<WeekScheduleDto>;
  profile?: Source<StudentProfile>;
  onboarding?: Source<OnboardingDto | null>;
  pickup?: Source<PickupBookingDto[]>;
}) {
  const name = profile.ok ? profile.data.fullName.trim().split(/\s+/)[0] : null;
  return (
    <div className="section-page today-page">
      <header className="space-y-2">
        <div className="today-meta-line" data-testid="today-meta">
          <h1>{t(language, todayMessages, "today")}</h1>
          <p>
            · {todayDateHeading(data.asOf, language)} ·{" "}
            {t(language, todayMessages, "studyDay")}
          </p>
        </div>
        <p
          className="text-greeting font-extrabold leading-tight tracking-tight"
          data-testid="today-greeting"
        >
          {greeting(data.asOf, language)}
          {name ? `, ${name}` : ""}
        </p>
        {!profile.ok && (
          <SourceError name={t(language, todayMessages, "profile")} />
        )}
      </header>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-5">
        <div className="min-w-0 space-y-4">
          {data.schedule.ok ? (
            <DayPulse data={data.schedule.data} />
          ) : (
            <SourceError name={t(language, todayMessages, "schedule")} />
          )}
          {data.schedule.ok && (
            <Changes data={data.schedule.data} language={language} />
          )}
          <WeekOverview source={week} language={language} />
        </div>
        <div className="min-w-0 space-y-4">
          <TodayBriefingCard data={data} serverSpeech={serverSpeech} />
          <Actions data={data} language={language} />
          {profile.ok &&
            profile.data.course === 1 &&
            (onboarding.ok ? (
              onboarding.data && <OnboardingCard initial={onboarding.data} />
            ) : (
              <SourceError name={t(language, todayMessages, "onboarding")} />
            ))}
          <Study source={data.study} language={language} />
          {pickup.ok && (
            <PickupToday bookings={pickup.data} className="lg:hidden" />
          )}
          <Requests
            source={data.requests}
            pickup={pickup}
            language={language}
          />
          <TodayAssistantCard />
        </div>
      </div>
    </div>
  );
}
