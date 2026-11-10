import { beforeEach, expect, it } from "vitest";
import { ChangeRequestStatus } from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { PreviewEventRelease } from "@/application/requests/event-release";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/application/shared/errors";
import { EVENT_ACTIVITY_POINTS } from "@/domain/requests/event-release";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina, timur } from "../fakes/identity";
import {
  eventPayload,
  eventType,
  FakeEventAttendance,
  FakeEventRequests,
} from "../fakes/requests-event";
import {
  FakeScheduleRepository,
  change as scheduleChange,
  scheduleData,
  slot,
} from "../fakes/schedule";

const clock = new FakeClock("2026-11-01T09:00:00Z");
let db: FakeEventRequests;
let schedule: FakeScheduleRepository;
let attendance: FakeEventAttendance;
let status: ChangeRequestStatus;
let id: string;
beforeEach(async () => {
  schedule = new FakeScheduleRepository();
  if (anna.kind !== "student") throw new Error("Нужен студент");
  schedule.records.set(
    anna.studentId,
    scheduleData({
      slots: [slot, { ...slot, id: "slot-2", startsAt: "11:00:00" }],
    }),
  );
  attendance = new FakeEventAttendance();
  db = new FakeEventRequests({ schedule, attendance });
  db.types.push(eventType);
  const ids = new SequentialIdGenerator();
  status = new ChangeRequestStatus(db, clock, ids);
  ({ id } = await new CreateRequestDraft(db, clock, ids).execute(anna, {
    typeCode: "event_release",
    payload: { ...eventPayload, eventLessons: [{ slotId: "forged" }] },
  }));
});
async function progress() {
  await status.execute(anna, { id, to: "submitted" });
  await status.execute(marina, { id, to: "accepted" });
  await status.execute(marina, { id, to: "in_progress" });
}
it("превью только по Actor; отправка сохраняет серверный список, одобрение пересчитывает", async () => {
  const preview = new PreviewEventRelease(schedule, clock);
  expect(
    await preview.execute(anna, {
      dateFrom: eventPayload.dateFrom,
      dateTo: eventPayload.dateTo,
    }),
  ).toHaveLength(2);
  expect(db.records[0]?.payload).not.toHaveProperty("eventLessons");
  await progress();
  expect(db.records[0]?.payload.eventLessons).toHaveLength(2);
  if (anna.kind !== "student") throw new Error("Нужен студент");
  schedule.records.set(
    anna.studentId,
    scheduleData({ changes: [scheduleChange({ kind: "cancelled" })] }),
  );
  await status.execute(marina, { id, to: "ready" });
  expect(attendance.records.size).toBe(0);
  expect([...attendance.points.values()]).toEqual([EVENT_ACTIVITY_POINTS]);
  expect(db.notifications.at(-1)?.title).toBe(
    "Освобождение одобрено: 0 пар — уважительная причина",
  );
});
it("одобрение отмечает свои пары с причиной и стабильным источником; issued не удваивает", async () => {
  await progress();
  await status.execute(marina, { id, to: "ready" });
  expect(attendance.records.size).toBe(2);
  expect(new Set(attendance.owners)).toEqual(
    new Set([anna.kind === "student" && anna.studentId]),
  );
  for (const row of attendance.records.values())
    expect(row).toMatchObject({
      status: "excused",
      reason: eventPayload.eventName,
      sourceKey: `event:${id}`,
    });
  expect(db.notifications.at(-1)?.title).toBe(
    "Освобождение одобрено: 2 пар — уважительная причина",
  );
  const snapshot = structuredClone(attendance.records);
  await expect(status.execute(marina, { id, to: "ready" })).rejects.toThrow(
    ConflictError,
  );
  await status.execute(marina, { id, to: "issued" });
  expect(attendance.records).toEqual(snapshot);
  expect(attendance.points.size).toBe(1);
});
it.each(["rejected", "needs_info"] as const)(
  "%s ничего не отмечает",
  async (to) => {
    await progress();
    await status.execute(marina, { id, to, comment: "Нужно подтверждение" });
    expect(attendance.records.size).toBe(0);
    expect(attendance.points.size).toBe(0);
  },
);
it("отказ второй отметки откатывает все эффекты; повтор даёт один набор", async () => {
  await progress();
  const events = structuredClone(db.events);
  const notifications = structuredClone(db.notifications);
  attendance.failAt = 2;
  await expect(status.execute(marina, { id, to: "ready" })).rejects.toThrow(
    "Тестовый отказ",
  );
  expect(db.records[0]?.status).toBe("in_progress");
  expect(attendance.records.size).toBe(0);
  expect(attendance.points.size).toBe(0);
  expect(db.events).toEqual(events);
  expect(db.notifications).toEqual(notifications);
  attendance.failAt = -1;
  await status.execute(marina, { id, to: "ready" });
  expect(attendance.records.size).toBe(2);
  expect(attendance.points.size).toBe(1);
});
it("отказ уведомления откатывает статус, отметки и баллы; повтор даёт один набор", async () => {
  await progress();
  const events = structuredClone(db.events);
  const notifications = structuredClone(db.notifications);
  db.failNotification = true;
  await expect(status.execute(marina, { id, to: "ready" })).rejects.toThrow();
  expect(attendance.calls).toBe(2);
  expect(db.records[0]?.status).toBe("in_progress");
  expect(attendance.records.size).toBe(0);
  expect(attendance.points.size).toBe(0);
  expect(db.events).toEqual(events);
  expect(db.notifications).toEqual(notifications);
  db.failNotification = false;
  await status.execute(marina, { id, to: "ready" });
  expect(attendance.records.size).toBe(2);
  expect(attendance.points.size).toBe(1);
});
it("отклонение после неудачного одобрения не оставляет отметок и баллов", async () => {
  await progress();
  db.failNotification = true;
  await expect(status.execute(marina, { id, to: "ready" })).rejects.toThrow();
  db.failNotification = false;
  await status.execute(marina, {
    id,
    to: "rejected",
    comment: "Подтверждение участия не принято",
  });
  expect(db.records[0]?.status).toBe("rejected");
  expect(attendance.records.size).toBe(0);
  expect(attendance.points.size).toBe(0);
  expect(db.events.some((event) => event.toStatus === "ready")).toBe(false);
  expect(
    db.notifications.some((notice) =>
      notice.title.includes("Освобождение одобрено"),
    ),
  ).toBe(false);
});
it("чужой студент, чужой факультет и преподаватель не запускают эффекты", async () => {
  await progress();
  await expect(status.execute(timur, { id, to: "cancelled" })).rejects.toThrow(
    NotFoundError,
  );
  await expect(
    status.execute(
      { ...marina, kind: "staff", staffId: "other", facultyIds: ["other"] },
      { id, to: "ready" },
    ),
  ).rejects.toThrow(NotFoundError);
  const teacher = { kind: "teacher", userId: "u", teacherId: "t" } as const;
  await expect(status.execute(teacher, { id, to: "ready" })).rejects.toThrow(
    ForbiddenError,
  );
  await expect(
    new PreviewEventRelease(schedule, clock).execute(teacher, {}),
  ).rejects.toThrow(ForbiddenError);
  expect(attendance.calls).toBe(0);
});

it.each(["submitted", "in_progress"] as const)(
  "студент не одобряет собственную заявку из %s и не создаёт эффектов",
  async (from) => {
    if (from === "in_progress") await progress();
    else await status.execute(anna, { id, to: "submitted" });
    const before = structuredClone({
      requests: db.records,
      events: db.events,
      notifications: db.notifications,
      marks: attendance.records,
      points: attendance.points,
    });
    await expect(status.execute(anna, { id, to: "ready" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(db.records[0]?.status).toBe(from);
    expect({
      requests: db.records,
      events: db.events,
      notifications: db.notifications,
      marks: attendance.records,
      points: attendance.points,
    }).toEqual(before);
    expect(attendance.calls).toBe(0);
  },
);
