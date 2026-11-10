import { afterAll, beforeAll, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { EVENT_ACTIVITY_POINTS } from "@/domain/requests/event-release";
import {
  type EventRequestFixture,
  openEventRequestFixture,
} from "./requests-event-data";

let f: EventRequestFixture;
beforeAll(async () => {
  f = await openEventRequestFixture();
});
afterAll(async () => {
  await f?.close();
});
it("PostgreSQL: серверный снимок → excused, уведомление, одни баллы; повтор/issued без дубля", async () => {
  const id = await f.createEvent();
  const lessons = await f.preview.execute(f.anna, {
    dateFrom: f.payload.dateFrom,
    dateTo: f.payload.dateTo,
  });
  expect(lessons.length).toBeGreaterThan(0);
  expect((await f.get.execute(f.anna, { id })).payload.eventLessons).toEqual(
    lessons,
  );
  await f.progress(id);
  await f.change.execute(f.limited, { id, to: "ready" });
  const rows =
    await f.sql`select * from attendance_records where source_key = ${`event:${id}`}`;
  expect(rows).toHaveLength(lessons.length);
  for (const row of rows)
    expect(row).toMatchObject({
      status: "excused",
      reason: f.payload.eventName,
      student_id: f.anna.kind === "student" && f.anna.studentId,
    });
  const points =
    await f.sql`select points from activity_points where source_key = ${`event:${id}`}`;
  expect(points).toEqual([{ points: EVENT_ACTIVITY_POINTS }]);
  const notice =
    await f.sql`select title from notifications where user_id = ${f.anna.userId} and link = ${`/requests/${id}`} and title like 'Освобождение одобрено:%'`;
  expect(notice).toEqual([
    {
      title: `Освобождение одобрено: ${lessons.length} пар — уважительная причина`,
    },
  ]);
  await expect(
    f.change.execute(f.limited, { id, to: "ready" }),
  ).rejects.toThrow(ConflictError);
  await f.change.execute(f.limited, { id, to: "issued" });
  expect(
    await f.sql`select * from attendance_records where source_key = ${`event:${id}`}`,
  ).toEqual(rows);
  expect(
    await f.sql`select points from activity_points where source_key = ${`event:${id}`}`,
  ).toEqual(points);
});
it.each(["rejected", "needs_info"] as const)(
  "PostgreSQL: %s без отметок и баллов",
  async (to) => {
    const id = await f.createEvent();
    await f.progress(id);
    await f.change.execute(f.limited, {
      id,
      to,
      comment: "Уточните приглашение",
    });
    expect(
      await f.sql`select id from attendance_records where source_key = ${`event:${id}`}`,
    ).toHaveLength(0);
    expect(
      await f.sql`select id from activity_points where source_key = ${`event:${id}`}`,
    ).toHaveLength(0);
  },
);
it("security: чужой факультет, IDOR и лишний studentId до эффектов", async () => {
  const id = await f.createEvent();
  await f.progress(id);
  await expect(
    f.change.execute(
      {
        ...f.limited,
        kind: "staff",
        staffId: f.limited.kind === "staff" ? f.limited.staffId : "",
        facultyIds: [f.timur.kind === "student" ? f.timur.facultyId : ""],
      },
      { id, to: "ready" },
    ),
  ).rejects.toThrow(NotFoundError);
  await expect(f.get.execute(f.timur, { id })).rejects.toThrow(NotFoundError);
  await expect(
    f.preview.execute(f.anna, { dateFrom: "2026-11-01", dateTo: "2026-11-15" }),
  ).rejects.toThrow(ValidationError);
  await expect(
    f.preview.execute(f.anna, {
      dateFrom: "2026-11-01",
      dateTo: "2026-11-02",
      studentId: f.timur.kind === "student" && f.timur.studentId,
    }),
  ).rejects.toThrow(ValidationError);
  expect((await f.get.execute(f.anna, { id })).status).toBe("in_progress");
  expect(
    await f.sql`select id from attendance_records where source_key = ${`event:${id}`}`,
  ).toHaveLength(0);
});
