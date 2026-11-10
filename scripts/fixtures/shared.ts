import type { Clock } from "../../src/application/ports/clock";
import type { IdGenerator } from "../../src/application/ports/id-generator";

const day = 86_400_000;
export function moscowDate(instant: Date): string {
  return new Date(instant.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function addWorkDays(instant: Date, count: number): Date {
  const result = new Date(instant);
  let left = Math.abs(count);
  while (left > 0) {
    result.setUTCDate(result.getUTCDate() + Math.sign(count));
    const weekday = new Date(result.getTime() + 3 * 3_600_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return result;
}

export function fixtureContext(
  clock: Clock,
  ids: IdGenerator,
  existing = new Map<string, string>(),
) {
  const now = clock.now();
  const today = moscowDate(now);
  const at = (offset: number, hour = 12) =>
    new Date(
      new Date(
        `${today}T${String(hour).padStart(2, "0")}:00:00+03:00`,
      ).getTime() +
        offset * day,
    );
  const id = (key: string) => {
    let value = existing.get(key);
    if (!value) {
      value = ids.next();
      existing.set(key, value);
    }
    return value;
  };
  const row = (key: string) => ({
    id: id(`demo:${key}`),
    seedKey: `demo:${key}`,
  });
  const studyDay = at(0).getUTCDay() === 0 ? at(1) : at(0);
  return { now, today, at, id, row, studyDay };
}
export type FixtureContext = ReturnType<typeof fixtureContext>;
