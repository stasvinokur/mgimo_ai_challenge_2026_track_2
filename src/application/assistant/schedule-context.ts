import type { Lesson } from "../schedule/get-schedule";
import { formatCountdown } from "../today/countdown";

const moscowDateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const moscowTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});
const plurals = new Intl.PluralRules("ru-RU");

export function formatMoscowDateTime(instant: string): string {
  return `${moscowDateTime.format(new Date(instant))} МСК`;
}

function spokenCountdown(startsAt: string, now: string): string {
  return formatCountdown(startsAt, now)
    .toLocaleLowerCase("ru-RU")
    .replace(
      /(\d+) (мин|ч)(?!\p{L})/gu,
      (_match, count: string, unit: string) => {
        const forms =
          unit === "мин"
            ? { one: "минуту", few: "минуты", many: "минут", other: "минут" }
            : { one: "час", few: "часа", many: "часов", other: "часов" };
        const form = plurals.select(Number(count));
        return `${count} ${forms[form as keyof typeof forms] ?? forms.other}`;
      },
    );
}

export function withLessonTiming(lesson: Lesson, now: string) {
  const timestamp = Date.parse(now);
  const relativeTime =
    lesson.status === "cancelled"
      ? "отменена"
      : lesson.status === "moved-from"
        ? "перенесена"
        : Date.parse(lesson.endsAt) <= timestamp
          ? "завершилась"
          : Date.parse(lesson.startsAt) <= timestamp
            ? `идёт сейчас, до ${moscowTime.format(new Date(lesson.endsAt))} МСК`
            : spokenCountdown(lesson.startsAt, now);
  return {
    ...lesson,
    startsAtMoscow: formatMoscowDateTime(lesson.startsAt),
    endsAtMoscow: formatMoscowDateTime(lesson.endsAt),
    relativeTime,
  };
}
