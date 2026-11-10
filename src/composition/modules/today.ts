import "server-only";
import type { Clock } from "@/application/ports/clock";
import { GetTodayOverview } from "@/application/today/get-today";
import type { TodaySources } from "@/application/today/ports";

export function createTodayModule(sources: TodaySources, clock: Clock) {
  return { getOverview: new GetTodayOverview(sources, clock) };
}
