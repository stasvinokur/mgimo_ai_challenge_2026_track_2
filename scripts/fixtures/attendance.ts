import type * as s from "../../src/infrastructure/db/schema/attendance";
import { type FixtureContext, moscowDate } from "./shared";

export function attendanceFixtures(ctx: FixtureContext) {
  const attendanceRecords: (typeof s.attendanceRecords.$inferInsert)[] = [];
  const activityPoints: (typeof s.activityPoints.$inferInsert)[] = [];
  for (const [login, group] of [
    ["anna", "fmo"],
    ["timur", "imp"],
  ] as const) {
    for (let week = 1; week <= 3; week++) {
      const at = new Date(ctx.studyDay.getTime() - week * 7 * 86_400_000);
      for (const pair of [0, 1]) {
        const row = ctx.row(`attendance:${login}:${week}:${pair}`);
        const status =
          week === 2 && pair === 1
            ? "excused"
            : login === "anna" || pair === 0
              ? "present"
              : "absent";
        attendanceRecords.push({
          ...row,
          studentId: ctx.row(`student:${login}`).id,
          slotId: ctx.row(`slot:${group}:${at.getUTCDay()}:${pair}`).id,
          occurrenceDate: moscowDate(at),
          status,
          source: "demo",
          sourceKey: row.seedKey,
          reason:
            status === "excused"
              ? "Участие в учебной конференции (вымышленной)."
              : null,
          markedAt: at,
        });
        if (status === "present")
          activityPoints.push({
            ...ctx.row(`activity:${login}:${week}:${pair}`),
            studentId: ctx.row(`student:${login}`).id,
            sourceKey: row.seedKey,
            points: 1,
            createdAt: at,
          });
      }
    }
  }
  return { attendanceRecords, activityPoints };
}
