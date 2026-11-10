import type { RequestStatus } from "@/application/requests/dto";
import type { TodayScheduleDto } from "@/application/schedule/get-schedule";
import { getCountdown } from "@/application/today/countdown";
import type { TodayDto } from "@/application/today/get-today";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export function sameMoscowDate(first: string, second: string) {
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  } as const;
  return formatDate("ru", first, options) === formatDate("ru", second, options);
}

export function todayDate(
  value: string,
  withTime = false,
  language: Language = "ru",
) {
  return formatDate(
    language,
    value.length === 10 ? `${value}T12:00:00+03:00` : value,
    {
      day: "numeric",
      month: "long",
      ...(withTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
    },
  );
}
export function todayTime(value: string, language: Language = "ru") {
  return formatDate(language, value, { hour: "2-digit", minute: "2-digit" });
}
export function todayDateHeading(value: string, language: Language = "ru") {
  const label = formatDate(language, value, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    label.charAt(0).toLocaleUpperCase(language === "ru" ? "ru-RU" : "en-GB") +
    label.slice(1)
  );
}
export function greeting(value: string, language: Language = "ru") {
  const hour = Number(
    formatDate("en", value, { hour: "numeric", hourCycle: "h23" }),
  );
  return t(
    language,
    todayMessages,
    hour < 6
      ? "night"
      : hour < 12
        ? "morning"
        : hour < 18
          ? "afternoon"
          : "evening",
  );
}
export function countedTime(
  value: number,
  unit: "hour" | "minute",
  language: Language = "ru",
) {
  const form = new Intl.PluralRules(
    language === "ru" ? "ru-RU" : "en-GB",
  ).select(value);
  const suffix = form === "one" ? "One" : form === "few" ? "Few" : "Many";
  return t(language, todayMessages, `${unit}${suffix}`, {
    count: formatNumber(language, value),
  });
}
export function localizedCountdown(
  startsAt: string,
  now: string,
  language: Language = "ru",
  spoken = false,
) {
  const message = getCountdown(startsAt, now);
  switch (message.code) {
    case "now":
      return t(language, todayMessages, "startsNow");
    case "minutes":
      return t(
        language,
        todayMessages,
        spoken ? "spokenMinutes" : "inMinutes",
        {
          minutes: spoken
            ? countedTime(message.minutes, "minute", language)
            : formatNumber(language, message.minutes),
        },
      );
    case "hours":
      return t(language, todayMessages, spoken ? "spokenHours" : "inHours", {
        hours: spoken
          ? countedTime(message.hours, "hour", language)
          : formatNumber(language, message.hours),
        minutes: message.minutes
          ? spoken
            ? ` ${countedTime(message.minutes, "minute", language)}`
            : t(language, todayMessages, "minuteRest", {
                minutes: formatNumber(language, message.minutes),
              })
          : "",
      });
    case "tomorrow":
      return t(language, todayMessages, "tomorrowAt", {
        time: todayTime(message.startsAt, language),
      });
    case "date":
      return t(language, todayMessages, "dateAt", {
        date: todayDate(message.startsAt, false, language),
        time: todayTime(message.startsAt, language),
      });
  }
}

export function dayTimeline(data: TodayScheduleDto) {
  const intervals = data.lessons
    .filter(
      (lesson) => lesson.status === "scheduled" || lesson.status === "moved-to",
    )
    .map((lesson) => ({
      start: Date.parse(lesson.startsAt),
      end: Date.parse(lesson.endsAt),
      title: lesson.course,
    }));
  const midnight = Date.parse(`${data.date}T00:00:00+03:00`);
  const hour = 3_600_000;
  const first = intervals.length
    ? Math.min(...intervals.map((item) => item.start))
    : midnight + 9 * hour;
  const last = intervals.length
    ? Math.max(...intervals.map((item) => item.end))
    : midnight + 17 * hour;
  const padding = Math.max(hour / 2, (4 * hour - (last - first)) / 2);
  return {
    intervals,
    dayStart: Math.max(midnight, first - padding),
    dayEnd: Math.min(midnight + 24 * hour, last + padding),
  };
}

export function requestStage(status: RequestStatus) {
  const stages: readonly RequestStatus[] = [
    "submitted",
    "accepted",
    "in_progress",
    "ready",
    "issued",
  ];
  return stages.indexOf(status) + 1;
}
export function requestStatus(
  status: RequestStatus,
  language: Language = "ru",
) {
  return t(
    language,
    todayMessages,
    (
      {
        draft: "requestDraft",
        submitted: "requestSubmitted",
        accepted: "requestAccepted",
        in_progress: "requestInProgress",
        ready: "requestReady",
        needs_info: "requestNeedsInfo",
        issued: "requestIssued",
        rejected: "requestRejected",
        cancelled: "requestCancelled",
      } as const
    )[status],
  );
}

export function scholarshipHeadline(
  scholarship: Extract<TodayDto["study"], { ok: true }>["data"]["scholarship"],
  language: Language = "ru",
) {
  const title = t(
    language,
    todayMessages,
    scholarship.current === "increased"
      ? "scholarshipIncreased"
      : "scholarshipAcademic",
  );
  const none = t(language, todayMessages, "scholarshipNone");
  if (scholarship.state === "debt")
    return t(language, todayMessages, "scholarshipDebt", {
      title:
        scholarship.current === "none"
          ? none
          : t(language, todayMessages, "scholarshipRisk", { title }),
      course: scholarship.debtCourse ?? "",
    });
  if (scholarship.state === "clarification")
    return t(language, todayMessages, "scholarshipClarification");
  const requirement = scholarship.requirement;
  const hint = requirement
    ? t(language, todayMessages, "scholarshipRequirement", {
        minimum: formatNumber(language, requirement.minimum),
        maxScore: formatNumber(language, requirement.maxScore),
        work: requirement.title,
        course: requirement.course,
        more: scholarship.moreRequirements
          ? t(language, todayMessages, "scholarshipMore")
          : "",
      })
    : t(language, todayMessages, "scholarshipCheck");
  const increasedOutlook =
    scholarship.level === "increased"
      ? t(language, todayMessages, "increasedAchievable")
      : scholarship.goalReachable
        ? t(language, todayMessages, "increasedRequirement", { hint })
        : t(language, todayMessages, "increasedUnreachable");
  if (scholarship.state === "retained")
    return (
      t(language, todayMessages, "scholarshipRetained", { title }) +
      (scholarship.current === "academic" ? ` ${increasedOutlook}` : "")
    );
  if (scholarship.state === "eligible")
    return `${none}. ${scholarship.level === "academic" ? `${t(language, todayMessages, "academicAchievable")} ` : ""}${increasedOutlook}`;
  if (scholarship.state === "unreachable")
    return `${scholarship.current === "none" ? `${none}. ` : ""}${t(language, todayMessages, "scholarshipUnreachable", { title: t(language, todayMessages, scholarship.goalLevel === "increased" ? "scholarshipIncreased" : "scholarshipAcademic") })}`;
  return scholarship.current === "none"
    ? t(language, todayMessages, "academicRequirement", { hint })
    : t(language, todayMessages, "riskRequirement", { title, hint });
}
