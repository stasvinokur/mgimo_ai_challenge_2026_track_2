import { addDays } from "../schedule/dates";
import {
  buildSchedule,
  isActive,
  type ScheduleData,
} from "../schedule/schedule";
import { ValidationError } from "../shared/errors";

export const EVENT_RELEASE_TYPE = "event_release";
export const EVENT_ACTIVITY_POINTS = 5;
export const EVENT_MAX_DAYS = 14;
export const EVENT_MIN_YEAR = 2000;
export const EVENT_MAX_YEAR = 2100;
export const EVENT_PAST_DAYS = 14;
export const EVENT_FUTURE_DAYS = 60;

export function validEventDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= EVENT_MIN_YEAR &&
    Number(value.slice(0, 4)) <= EVENT_MAX_YEAR &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export type EventDateMessage =
  | {
      code:
        | "requestInvalidDates"
        | "requestDateOrder"
        | "requestPeriodUnavailable";
    }
  | {
      code:
        | "requestEventTooLong"
        | "requestDateTooEarly"
        | "requestDateTooLate";
      params: { days: number };
    };

export function eventDateMessages(
  from: string,
  to: string,
  today?: string,
): Record<string, EventDateMessage[]> | null {
  if (!validEventDate(from) || !validEventDate(to))
    return { dateFrom: [{ code: "requestInvalidDates" }] };
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (days < 1) return { dateTo: [{ code: "requestDateOrder" }] };
  if (days > EVENT_MAX_DAYS)
    return {
      dateTo: [
        { code: "requestEventTooLong", params: { days: EVENT_MAX_DAYS } },
      ],
    };
  if (today !== undefined) {
    if (!validEventDate(today))
      return { dateFrom: [{ code: "requestPeriodUnavailable" }] };
    if (from < addDays(today, -EVENT_PAST_DAYS))
      return {
        dateFrom: [
          { code: "requestDateTooEarly", params: { days: EVENT_PAST_DAYS } },
        ],
      };
    if (to > addDays(today, EVENT_FUTURE_DAYS))
      return {
        dateTo: [
          { code: "requestDateTooLate", params: { days: EVENT_FUTURE_DAYS } },
        ],
      };
  }
  return null;
}

function eventDateText(message: EventDateMessage): string {
  switch (message.code) {
    case "requestInvalidDates":
      return "Укажите существующие даты с годом.";
    case "requestDateOrder":
      return "Дата «по» не может быть раньше даты «с».";
    case "requestPeriodUnavailable":
      return "Не удалось проверить допустимый период. Повторите позже.";
    case "requestEventTooLong":
      return `Не больше ${message.params.days} дней включительно.`;
    case "requestDateTooEarly":
      return `Дата «с» — не раньше чем ${message.params.days} дней назад.`;
    case "requestDateTooLate":
      return `Дата «по» — не позже чем через ${message.params.days} дней.`;
  }
}

// Russian consumers outside the student UI keep their existing representation.
export function eventDateErrors(
  from: string,
  to: string,
  today?: string,
): Record<string, string[]> | null {
  const messages = eventDateMessages(from, to, today);
  return messages
    ? Object.fromEntries(
        Object.entries(messages).map(([field, errors]) => [
          field,
          errors.map(eventDateText),
        ]),
      )
    : null;
}

export interface EventLesson {
  slotId: string;
  occurrenceDate: string;
  date: string;
  course: string;
  startsAt: string;
  endsAt: string;
  room: string;
}

export function eventLessons(
  data: ScheduleData,
  from: string,
  to: string,
): EventLesson[] {
  const errors = eventDateErrors(from, to);
  if (errors) throw new ValidationError(errors);
  return buildSchedule(data, from, to)
    .filter(isActive)
    .map((lesson) => ({
      slotId: lesson.id.slice(0, -11),
      occurrenceDate: lesson.id.slice(-10),
      date: lesson.date,
      course: lesson.course,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      room: lesson.room,
    }));
}
