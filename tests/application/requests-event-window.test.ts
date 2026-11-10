import { expect, it } from "vitest";
import { ChangeRequestStatus } from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { PreviewEventRelease } from "@/application/requests/event-release";
import { ValidationError } from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina } from "../fakes/identity";
import {
  eventPayload,
  eventType,
  FakeEventAttendance,
  FakeEventRequests,
} from "../fakes/requests-event";
import { FakeScheduleRepository, scheduleData } from "../fakes/schedule";

function fixture() {
  const clock = new FakeClock("2026-11-05T09:00:00.000Z");
  const ids = new SequentialIdGenerator();
  const schedule = new FakeScheduleRepository();
  if (anna.kind !== "student") throw new Error("Нужен студент");
  schedule.records.set(anna.studentId, scheduleData());
  const attendance = new FakeEventAttendance();
  const db = new FakeEventRequests({ schedule, attendance });
  db.types.push(eventType);
  return {
    clock,
    attendance,
    db,
    create: new CreateRequestDraft(db, clock, ids),
    change: new ChangeRequestStatus(db, clock, ids),
    preview: new PreviewEventRelease(schedule, clock),
  };
}

it("отправка и одобрение очищают сохранённое название старого черновика", async () => {
  const f = fixture();
  const { id } = await f.create.execute(anna, {
    typeCode: "event_release",
    payload: eventPayload,
  });
  const dirtyName = `\u202e ${eventPayload.eventName}\u200b `;
  const draft = f.db.records.find((record) => record.id === id);
  if (!draft) throw new Error("Нет черновика");
  draft.payload.eventName = dirtyName;
  const submitted = await f.change.execute(anna, { id, to: "submitted" });
  expect(submitted.payload.eventName).toBe(eventPayload.eventName);
  expect(f.db.records[0]?.payload.eventName).toBe(eventPayload.eventName);
  await f.change.execute(marina, { id, to: "accepted" });
  await f.change.execute(marina, { id, to: "in_progress" });
  const inProgress = f.db.records.find((record) => record.id === id);
  if (!inProgress) throw new Error("Нет заявки");
  inProgress.payload.eventName = dirtyName;
  const ready = await f.change.execute(marina, { id, to: "ready" });
  expect(ready.payload.eventName).toBe(eventPayload.eventName);
  expect(f.db.records[0]?.payload.eventName).toBe(eventPayload.eventName);
  expect(f.attendance.records.size).toBeGreaterThan(0);
  for (const record of f.attendance.records.values())
    expect(record.reason).toBe(eventPayload.eventName);
  expect(f.attendance.points.size).toBe(1);
});

it("создание и превью отклоняют начало периода 15 дней назад без эффектов", async () => {
  const f = fixture();
  const payload = {
    ...eventPayload,
    dateFrom: "2026-10-21",
    dateTo: "2026-10-22",
  };
  await expect(
    f.create.execute(anna, { typeCode: "event_release", payload }),
  ).rejects.toThrow(ValidationError);
  await expect(
    f.preview.execute(anna, {
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
    }),
  ).rejects.toThrow(ValidationError);
  expect(f.db.records).toHaveLength(0);
  expect(f.db.events).toHaveLength(0);
  expect(f.db.notifications).toHaveLength(0);
  expect(f.attendance.records.size).toBe(0);
  expect(f.attendance.points.size).toBe(0);
  expect(f.attendance.calls).toBe(0);
});

it("одобрение повторно проверяет окно по Clock и не отмечает устаревшую заявку", async () => {
  const f = fixture();
  const { id } = await f.create.execute(anna, {
    typeCode: "event_release",
    payload: eventPayload,
  });
  await f.change.execute(anna, { id, to: "submitted" });
  await f.change.execute(marina, { id, to: "accepted" });
  await f.change.execute(marina, { id, to: "in_progress" });
  const before = structuredClone({
    records: f.db.records,
    events: f.db.events,
    notifications: f.db.notifications,
  });
  f.clock.set("2026-11-17T09:00:00.000Z");
  await expect(f.change.execute(marina, { id, to: "ready" })).rejects.toThrow(
    ValidationError,
  );
  expect({
    records: f.db.records,
    events: f.db.events,
    notifications: f.db.notifications,
  }).toEqual(before);
  expect(f.attendance.records.size).toBe(0);
  expect(f.attendance.points.size).toBe(0);
  expect(f.attendance.calls).toBe(0);
});
