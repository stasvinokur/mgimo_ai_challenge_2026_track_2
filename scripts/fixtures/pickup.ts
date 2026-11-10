import type * as s from "../../src/infrastructure/db/schema/requests";
import type { FixtureContext } from "./shared";
import { demoGroups } from "./student";

export function pickupFixtures(ctx: FixtureContext) {
  const pickupWindows: (typeof s.pickupWindows.$inferInsert)[] = demoGroups.map(
    (faculty, index) => ({
      ...ctx.row(`pickup-window:${faculty}`),
      facultyId: ctx.row(`faculty:${faculty}`).id,
      title: index === 0 ? "Окно 3 · ФМО" : "Окно 1 · ИМП",
      opensAt: "09:00:00",
      closesAt: "17:00:00",
    }),
  );
  return { pickupWindows };
}
