import { beforeEach, expect, it, vi } from "vitest";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { GetStaffRequest } from "@/application/staff/queries";
import type { ScheduleData } from "@/domain/schedule/schedule";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina } from "../fakes/identity";
import {
  eventPayload,
  eventType,
  FakeEventAttendance,
  FakeEventRequests,
} from "../fakes/requests-event";
import {
  change,
  FakeScheduleRepository,
  scheduleData,
  slot,
} from "../fakes/schedule";
import { FakeStaff } from "../fakes/staff";

const clock = new FakeClock("2026-11-05T09:00:00Z");
let db: FakeStaff;
let get: GetStaffRequest;
let data: ScheduleData;
let id: string;
beforeEach(async () => {
  clock.set("2026-11-05T09:00:00Z");
  data = scheduleData({
    slots: [
      slot,
      { ...slot, id: "slot-absent", startsAt: "11:00:00", endsAt: "12:30:00" },
      { ...slot, id: "slot-excused", weekday: 2 },
      {
        ...slot,
        id: "slot-unmarked",
        weekday: 2,
        startsAt: "11:00:00",
        endsAt: "12:30:00",
      },
    ],
  });
  const schedule = new FakeScheduleRepository();
  if (anna.kind !== "student") throw new Error("Нужен студент");
  schedule.records.set(anna.studentId, data);
  const requests = new FakeEventRequests({
    schedule,
    attendance: new FakeEventAttendance(),
  });
  requests.types.push(eventType);
  db = new FakeStaff();
  db.requests = requests;
  const ids = new SequentialIdGenerator();
  const created = await new CreateRequestDraft(requests, clock, ids).execute(
    anna,
    { typeCode: "event_release", payload: eventPayload },
  );
  id = created.id;
  await new SubmitRequest(
    new ChangeRequestStatus(requests, clock, ids),
  ).execute(anna, { id });
  db.eventContexts.set(id, {
    schedule: data,
    records: [
      { slotId: slot.id, occurrenceDate: "2026-11-02", status: "present" },
      { slotId: "slot-absent", occurrenceDate: "2026-11-02", status: "absent" },
      {
        slotId: "slot-excused",
        occurrenceDate: "2026-11-03",
        status: "excused",
      },
    ],
  });
  get = new GetStaffRequest(db, clock);
});

it("сотрудник видит прошлый период, неизменившийся список и текущие статусы отметок", async () => {
  const detail = await get.execute(marina, { id });
  expect(detail.eventReview).toMatchObject({ past: true, changed: false });
  expect(
    detail.eventReview?.lessons.map((lesson) => lesson.attendanceStatus),
  ).toEqual(["present", "absent", "excused", null]);
  expect(detail.eventReview?.lessons).toHaveLength(4);
  expect(detail.payload.eventLessons).toHaveLength(4);
});

it("дата «с» равна сегодняшнему московскому дню и не считается прошлым периодом", async () => {
  clock.set("2026-11-01T22:30:00Z");
  expect((await get.execute(marina, { id })).eventReview?.past).toBe(false);
});

it("перенос и отмена видны как изменение после подачи; отметка переноса найдена по исходному ключу", async () => {
  const context = db.eventContexts.get(id);
  if (!context) throw new Error("Нет контекста мероприятия");
  context.schedule.changes = [
    change({ newDate: "2026-11-03" }),
    change({
      id: "cancel",
      slotId: "slot-excused",
      date: "2026-11-03",
      kind: "cancelled",
      newDate: null,
      newStartsAt: null,
      newEndsAt: null,
      newRoom: null,
    }),
  ];
  context.records.push({
    slotId: slot.id,
    occurrenceDate: "2026-11-03",
    status: "absent",
  });
  const submittedSnapshot = structuredClone(
    db.requests.records[0]?.payload.eventLessons,
  );
  const detail = await get.execute(marina, { id });
  expect(detail.eventReview).toMatchObject({ past: true, changed: true });
  expect(detail.eventReview?.lessons).toHaveLength(3);
  expect(
    detail.eventReview?.lessons.find((lesson) => lesson.slotId === slot.id),
  ).toMatchObject({
    occurrenceDate: "2026-11-02",
    date: "2026-11-03",
    startsAt: "2026-11-03T10:00:00.000Z",
    attendanceStatus: "present",
  });
  expect(
    detail.eventReview?.lessons.some(
      (lesson) => lesson.slotId === "slot-excused",
    ),
  ).toBe(false);
  expect(detail.payload.eventLessons).toEqual(submittedSnapshot);
});

it("смена отметки обновляет карточку без изменения самого списка занятий", async () => {
  const context = db.eventContexts.get(id);
  if (!context) throw new Error("Нет контекста мероприятия");
  context.records[0] = {
    slotId: slot.id,
    occurrenceDate: "2026-11-02",
    status: "excused",
  };
  const detail = await get.execute(marina, { id });
  expect(detail.eventReview?.changed).toBe(false);
  expect(detail.eventReview?.lessons[0]?.attendanceStatus).toBe("excused");
});

it("чужой факультет получает NotFound до чтения расписания и посещаемости", async () => {
  if (marina.kind !== "staff") throw new Error("Нужен сотрудник");
  const context = vi.spyOn(db, "findEventContextForFaculties");
  await expect(
    get.execute({ ...marina, facultyIds: ["imp"] }, { id }),
  ).rejects.toThrow(NotFoundError);
  expect(context).not.toHaveBeenCalled();
});

it.each([
  anna,
  { kind: "teacher", userId: "teacher-user", teacherId: "teacher" } as const,
])(
  "студент и преподаватель не читают контекст мероприятия: $kind",
  async (actor) => {
    const row = vi.spyOn(db, "findByIdForFaculties");
    const context = vi.spyOn(db, "findEventContextForFaculties");
    await expect(get.execute(actor, { id })).rejects.toThrow(ForbiddenError);
    expect(row).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  },
);
