import type {
  AssistantCodedMessage,
  DraftCard,
} from "@/application/assistant/ports";
import { withLessonTiming } from "@/application/assistant/schedule-context";
import type { Lesson } from "@/application/schedule/get-schedule";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

const typeKeys = {
  enrollment: "enrollment",
  military: "military",
  visa: "visa",
  scholarship: "scholarship",
  retake: "retake",
  academic_leave: "academic_leave",
  enrollment_paper: "enrollment_paper",
  event_release: "event_release",
  question: "questionType",
} as const;
const fieldKeys = {
  destination: "destination",
  office: "office",
  country: "country",
  course: "courseField",
  reason: "reason",
  period: "period",
  question: "question",
  eventName: "eventName",
  organizer: "organizer",
  dateFrom: "dateFrom",
  dateTo: "dateTo",
  eventFormat: "eventFormat",
  confirmation: "confirmation",
} as const;

export function draftTitle(language: Language, draft: DraftCard): string {
  const code = draft.typeCode as keyof typeof typeKeys;
  return language === "en" && Object.hasOwn(typeKeys, code)
    ? t(language, assistantMessages, typeKeys[code])
    : draft.title;
}

export function draftFieldTitle(
  language: Language,
  field: DraftCard["fields"][number],
): string {
  const name = field.name as keyof typeof fieldKeys;
  return language === "en" && Object.hasOwn(fieldKeys, name)
    ? t(language, assistantMessages, fieldKeys[name])
    : field.title;
}

export function draftFieldValue(
  language: Language,
  field: DraftCard["fields"][number],
): string {
  if (field.format !== "date" || !/^\d{4}-\d{2}-\d{2}$/.test(field.value))
    return field.value;
  const date = new Date(`${field.value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== field.value
  )
    return field.value;
  return formatDate(language, date, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function workingDays(language: Language, value: number): string {
  const form = new Intl.PluralRules(
    language === "ru" ? "ru-RU" : "en-GB",
  ).select(value);
  return t(
    language,
    assistantMessages,
    form === "one" ? "workDay" : form === "few" ? "workDaysFew" : "workDays",
    { count: formatNumber(language, value) },
  );
}

export function assistantMessage(
  language: Language,
  event: AssistantCodedMessage,
): string {
  if (event.code !== "nextLesson" && event.code !== "changedLesson")
    return t(language, assistantMessages, event.code, event.params);
  const params = event.params;
  const startsAt = String(params.startsAt);
  const endsAt = String(params.endsAt);
  const now = String(params.now);
  const status = String(params.status);
  let relative: string;
  if (language === "ru") {
    relative = withLessonTiming(
      { startsAt, endsAt, status } as Lesson,
      now,
    ).relativeTime;
  } else {
    const key =
      status === "cancelled"
        ? "cancelledLesson"
        : status === "moved-from"
          ? "movedLesson"
          : Date.parse(endsAt) <= Date.parse(now)
            ? "endedLesson"
            : Date.parse(startsAt) <= Date.parse(now)
              ? "currentLesson"
              : "countdown";
    relative = t(language, assistantMessages, key, {
      time: formatDate(language, endsAt, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      minutes: formatNumber(
        language,
        Math.max(
          0,
          Math.ceil((Date.parse(startsAt) - Date.parse(now)) / 60_000),
        ),
      ),
    });
  }
  return t(language, assistantMessages, event.code, {
    ...params,
    date: `${formatDate(language, startsAt, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} ${t(language, assistantMessages, "moscow")}`,
    relative,
  });
}
