import { expect, it } from "vitest";
import { formatRequestFieldValue } from "@/application/requests/format";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .formatToParts(new Date(`${value}T00:00:00Z`))
    .filter((part) => ["day", "month", "year"].includes(part.type))
    .map((part) => part.value)
    .join(" ");
}

it.each(["2015-01-01", "2024-02-29", "2026-11-12", "2026-11-13", "2026-12-31"])(
  "календарная дата %s отображается по-русски без суффикса года",
  (value) => {
    const formatted = formatRequestFieldValue({ format: "date" }, value);
    expect(formatted).toBe(dateLabel(value));
    expect(formatted).not.toContain("г.");
    expect(formatted).not.toBe(value);
  },
);

it.each([
  "",
  "2026-02-30",
  "2026-13-01",
  "2026-1-01",
  "2026-11-13T00:00:00Z",
  "Не указано",
])(
  "пустая или некорректная дата %s не подменяется и не вызывает ошибку",
  (value) =>
    expect(formatRequestFieldValue({ format: "date" }, value)).toBe(value),
);

it.each(["", "2026-11-13", "Учебный центр «Идея»"])(
  "обычное строковое поле %s не меняется",
  (value) => expect(formatRequestFieldValue({}, value)).toBe(value),
);
