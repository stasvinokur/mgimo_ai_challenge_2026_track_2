import { afterAll, beforeAll, expect, it } from "vitest";
import { ChangeRequestStatus } from "@/application/requests/change-request-status";
import { ValidationError } from "@/application/shared/errors";
import { staffCommentOptions } from "@/application/staff/dto";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import {
  type DemoStaffFixture,
  openDemoStaffFixture,
} from "./staff-demo-fixture";

let fixture: DemoStaffFixture;
beforeAll(async () => {
  fixture = await openDemoStaffFixture();
});
afterAll(async () => {
  await fixture?.close();
});

it("seed_key включает серверный список и исключает произвольный текст из истории и уведомления", async () => {
  const id = await fixture.request();
  await fixture.change.execute(fixture.marina, { id, to: "accepted" });
  await fixture.change.execute(fixture.marina, { id, to: "in_progress" });
  expect(
    (await fixture.get.execute(fixture.marina, { id })).demoCommentsOnly,
  ).toBe(true);
  await expect(
    fixture.change.execute(fixture.marina, {
      id,
      to: "needs_info",
      comment: "Текст постороннего посетителя",
    }),
  ).rejects.toBeInstanceOf(ValidationError);
  const option = staffCommentOptions.needs_info[0];
  await fixture.change.execute(fixture.marina, {
    id,
    to: "needs_info",
    commentCode: option.code,
  });
  const request = await fixture.get.execute(fixture.marina, { id });
  expect(request.events.at(-1)?.comment).toBe(option.label);
  const notifications = await fixture.sql<
    { body: string }[]
  >`select body from notifications where user_id = ${fixture.anna.userId} and link = ${`/requests/${id}`} order by created_at desc, id desc`;
  expect(notifications.some((row) => row.body === option.label)).toBe(true);
  expect(JSON.stringify({ request, notifications })).not.toContain(
    "Текст постороннего посетителя",
  );
});

it("без seed_key обычный сотрудник сохраняет свой комментарий", async () => {
  const id = await fixture.request();
  const comment = "Для этого обращения нужны дополнительные сведения.";
  await fixture.change.execute(fixture.limited, { id, to: "accepted" });
  await fixture.change.execute(fixture.limited, { id, to: "in_progress" });
  await fixture.change.execute(fixture.limited, {
    id,
    to: "needs_info",
    comment,
  });
  const request = await fixture.get.execute(fixture.limited, { id });
  expect(request.demoCommentsOnly).toBe(false);
  expect(request.events.at(-1)?.comment).toBe(comment);
});

it("общий use case проверяет seed_key без staff-обёртки и не пишет свободный текст", async () => {
  const core = new ChangeRequestStatus(
    new DrizzleRequestsUnitOfWork(() => fixture.sql, fixture.ids),
    fixture.clock,
    fixture.ids,
  );
  const id = await fixture.request();
  await core.execute(fixture.marina, { id, to: "accepted" });
  await core.execute(fixture.marina, { id, to: "in_progress" });
  const before = await fixture.get.execute(fixture.marina, { id });
  await expect(
    core.execute(fixture.marina, {
      id,
      to: "needs_info",
      comment: "Текст, переданный прямо в общий use case",
    }),
  ).rejects.toThrow(ValidationError);
  expect(await fixture.get.execute(fixture.marina, { id })).toEqual(before);
  const option = staffCommentOptions.needs_info[0];
  await core.execute(fixture.marina, {
    id,
    to: "needs_info",
    commentCode: option.code,
  });
  expect(
    (await fixture.get.execute(fixture.marina, { id })).events.at(-1)?.comment,
  ).toBe(option.label);
});
