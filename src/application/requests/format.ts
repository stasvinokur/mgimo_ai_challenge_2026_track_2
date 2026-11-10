import type { RequestField } from "./ports";

const calendarDate = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatRequestFieldValue(
  field: Pick<RequestField, "format">,
  value: string,
): string {
  if (field.format !== "date" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return value;
  return calendarDate
    .formatToParts(date)
    .filter((part) => ["day", "month", "year"].includes(part.type))
    .map((part) => part.value)
    .join(" ");
}
