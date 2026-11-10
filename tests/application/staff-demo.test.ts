import { expect, it } from "vitest";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { NotFoundError, ValidationError } from "@/application/shared/errors";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import { staffCommentOptions } from "@/application/staff/dto";
import {
  GetStaffRequest,
  ListStaffRequests,
} from "@/application/staff/queries";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina } from "../fakes/identity";
import { FakeStaff } from "../fakes/staff";

async function setup(demo: boolean) {
  const db = new FakeStaff();
  if (demo) db.demoUserIds.add(marina.userId);
  const clock = new FakeClock("2026-11-06T09:00:00Z");
  const ids = new SequentialIdGenerator();
  const change = new ChangeStaffRequestStatus(db, clock, ids, {
    info() {},
    warn() {},
    error() {},
  });
  const request = await new CreateRequestDraft(db.requests, clock, ids).execute(
    anna,
    {
      typeCode: "enrollment",
      payload: { destination: "Учебный центр" },
    },
  );
  await new SubmitRequest(
    new ChangeRequestStatus(db.requests, clock, ids),
  ).execute(anna, request);
  await change.execute(marina, { id: request.id, to: "accepted" });
  await change.execute(marina, { id: request.id, to: "in_progress" });
  return {
    db,
    clock,
    change,
    core: new ChangeRequestStatus(db.requests, clock, ids),
    id: request.id,
  };
}

it.each(["needs_info", "rejected"] as const)(
  "демо-сотрудник: %s принимает только код своего списка и сохраняет нейтральный текст",
  async (to) => {
    const { db, change, id } = await setup(true);
    const before = structuredClone({
      records: db.requests.records,
      events: db.requests.events,
      notifications: db.requests.notifications,
      audit: db.audit,
    });
    for (const input of [
      { comment: "Произвольный текст посетителя" },
      { comment: staffCommentOptions[to][0].label },
      { commentCode: "unknown" },
      {
        commentCode:
          staffCommentOptions[
            to === "needs_info" ? "rejected" : "needs_info"
          ][0].code,
      },
      { commentCode: staffCommentOptions[to][0].code, comment: "Подмена" },
    ]) {
      await expect(
        change.execute(marina, { id, to, ...input }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect({
      records: db.requests.records,
      events: db.requests.events,
      notifications: db.requests.notifications,
      audit: db.audit,
    }).toEqual(before);
    const option = staffCommentOptions[to][0];
    await change.execute(marina, { id, to, commentCode: option.code });
    expect(db.requests.events.at(-1)?.comment).toBe(option.label);
    expect(db.requests.notifications.at(-1)?.body).toBe(option.label);
  },
);

it("демо-сотрудник не добавляет свободный комментарий к переходу без обязательного комментария", async () => {
  const { db, change, id } = await setup(true);
  const events = db.requests.events.length;
  for (const input of [{ comment: "Подмена" }, { commentCode: "organization" }])
    await expect(
      change.execute(marina, { id, to: "ready", ...input }),
    ).rejects.toBeInstanceOf(ValidationError);
  expect(db.requests.events).toHaveLength(events);
});

it("демо-сотрудник не получает сведения о чужом факультете при подмене комментария", async () => {
  const { change, id } = await setup(true);
  if (marina.kind !== "staff") throw new Error("Нужен сотрудник.");
  await expect(
    change.execute(
      { ...marina, facultyIds: [] },
      {
        id,
        to: "needs_info",
        comment: "Подмена",
      },
    ),
  ).rejects.toBeInstanceOf(NotFoundError);
});

it("обычный сотрудник сохраняет свободный комментарий; DTO сообщает режим только для своего аккаунта", async () => {
  const { db, clock, change, id } = await setup(false);
  const list = new ListStaffRequests(db, clock);
  const get = new GetStaffRequest(db, clock);
  expect((await list.execute(marina, {})).demoCommentsOnly).toBe(false);
  expect((await get.execute(marina, { id })).demoCommentsOnly).toBe(false);
  const comment = "Уточните название учебной организации в заявке.";
  await change.execute(marina, { id, to: "needs_info", comment });
  expect(db.requests.events.at(-1)?.comment).toBe(comment);
  db.demoUserIds.add(marina.userId);
  expect((await list.execute(marina, {})).demoCommentsOnly).toBe(true);
  expect((await get.execute(marina, { id })).demoCommentsOnly).toBe(true);
});

it.each(["needs_info", "rejected"] as const)(
  "общий ChangeRequestStatus: демо %s защищён без staff-обёртки",
  async (to) => {
    const { db, core, id } = await setup(true);
    const before = structuredClone({
      records: db.requests.records,
      events: db.requests.events,
      notifications: db.requests.notifications,
    });
    const option = staffCommentOptions[to][0];
    for (const fields of [
      { comment: "Произвольный комментарий" },
      { comment: option.label },
      { commentCode: "unknown" },
      { commentCode: option.code, comment: "Подмена" },
    ])
      await expect(core.execute(marina, { id, to, ...fields })).rejects.toThrow(
        ValidationError,
      );
    expect({
      records: db.requests.records,
      events: db.requests.events,
      notifications: db.requests.notifications,
    }).toEqual(before);
    await core.execute(marina, { id, to, commentCode: option.code });
    expect(db.requests.events.at(-1)?.comment).toBe(option.label);
    expect(db.requests.notifications.at(-1)?.body).toBe(option.label);
  },
);

it("общий ChangeRequestStatus: обычный сотрудник сохраняет свободный текст", async () => {
  const { db, core, id } = await setup(false);
  const comment = "Комментарий обычного сотрудника";
  await core.execute(marina, { id, to: "needs_info", comment });
  expect(db.requests.events.at(-1)?.comment).toBe(comment);
});
