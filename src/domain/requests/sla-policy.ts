const moscowOffset = 3 * 60 * 60 * 1000;

export function addWorkDays(start: Date, workDays: number): Date {
  const local = new Date(start.getTime() + moscowOffset);
  for (let days = 0; days < workDays; ) {
    local.setUTCDate(local.getUTCDate() + 1);
    if (local.getUTCDay() !== 0 && local.getUTCDay() !== 6) days++;
  }
  return new Date(local.getTime() - moscowOffset);
}

export type SlaIndicator = "on_time" | "soon" | "overdue";
export function getSlaIndicator(dueAt: Date, now: Date): SlaIndicator {
  if (dueAt.getTime() < now.getTime()) return "overdue";
  return dueAt.getTime() <= addWorkDays(now, 1).getTime() ? "soon" : "on_time";
}
