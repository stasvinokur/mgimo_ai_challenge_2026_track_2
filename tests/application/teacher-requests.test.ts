import { expect, it, vi } from "vitest";
import type { Actor } from "@/application/ports/actor";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { ForbiddenError } from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, timur } from "../fakes/identity";
import { FakeRequests } from "../fakes/requests";
import { oleg } from "../fakes/teacher";

it("преподаватель не меняет ни свою прежнюю, ни чужую заявку; отказ происходит до транзакции", async () => {
  const database = new FakeRequests();
  const clock = new FakeClock("2026-11-05T09:00:00Z");
  const ids = new SequentialIdGenerator();
  const create = new CreateRequestDraft(database, clock, ids);
  const change = new ChangeRequestStatus(database, clock, ids);
  const submit = new SubmitRequest(change);
  const teacher: Actor = { ...oleg, userId: anna.userId };
  const targets: string[] = [];
  for (const actor of [anna, timur]) {
    const draft = await create.execute(actor, {
      typeCode: "enrollment",
      payload: { destination: "Учебный центр «Север»" },
    });
    await submit.execute(actor, draft);
    targets.push(draft.id);
  }
  expect(database.records[0]?.studentUserId).toBe(teacher.userId);
  expect(database.records[1]?.studentUserId).not.toBe(teacher.userId);
  const before = structuredClone({
    records: database.records,
    events: database.events,
    notifications: database.notifications,
    certificates: database.certificates,
  });
  const run = vi.spyOn(database, "run");
  for (const id of targets) {
    for (const to of ["accepted", "cancelled"]) {
      await expect(change.execute(teacher, { id, to })).rejects.toThrow(
        ForbiddenError,
      );
    }
  }
  await expect(change.execute(teacher, null)).rejects.toThrow(ForbiddenError);
  expect(run).not.toHaveBeenCalled();
  expect({
    records: database.records,
    events: database.events,
    notifications: database.notifications,
    certificates: database.certificates,
  }).toEqual(before);
});
