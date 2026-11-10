const DAY = 86_400_000;

export function moscowDate(now: Date): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

export function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date));
}

export function isoWeek(date: string): string {
  const thursday = addDays(weekStart(date), 3);
  const year = thursday.slice(0, 4);
  const first = weekStart(`${year}-01-04`);
  const number =
    1 +
    Math.round((Date.parse(weekStart(date)) - Date.parse(first)) / (7 * DAY));
  return `${year}-W${String(number).padStart(2, "0")}`;
}

export function dateFromWeek(week: string): string {
  return addDays(
    weekStart(`${week.slice(0, 4)}-01-04`),
    (Number(week.slice(6)) - 1) * 7,
  );
}

export function atMoscow(date: string, time: string): string {
  return new Date(
    `${date}T${time.slice(0, 8).padEnd(8, ":00")}+03:00`,
  ).toISOString();
}
