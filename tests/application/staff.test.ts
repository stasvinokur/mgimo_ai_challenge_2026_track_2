import { beforeEach, expect, it, vi } from "vitest";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import { allowedStaffActions } from "@/application/staff/dto";
import {
  GetStaffRequest,
  ListStaffRequests,
} from "@/application/staff/queries";
import { parseStaffFilters } from "@/application/staff/schemas";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina, timur } from "../fakes/identity";
import { FakeStaff } from "../fakes/staff";

const clock = new FakeClock("2026-11-04T09:00:00Z");
let db: FakeStaff;
let change: ChangeStaffRequestStatus;
let list: ListStaffRequests;
let get: GetStaffRequest;
let create: CreateRequestDraft;
let submit: SubmitRequest;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  clock.set("2026-11-04T09:00:00Z");
  db = new FakeStaff();
  const ids = new SequentialIdGenerator();
  create = new CreateRequestDraft(db.requests, clock, ids);
  submit = new SubmitRequest(new ChangeRequestStatus(db.requests, clock, ids));
  change = new ChangeStaffRequestStatus(db, clock, ids, logger);
  list = new ListStaffRequests(db, clock);
  get = new GetStaffRequest(db, clock);
  vi.clearAllMocks();
});
async function sent(owner = anna) {
  const result = await create.execute(owner, {
    typeCode: "enrollment",
    payload: { destination: "Учебный центр «Меридиан»" },
  });
  await submit.execute(owner, result);
  return result.id;
}
it("очередь содержит только данные канбана; payload и схема полей доступны только в детали", async () => {
  const id = await sent();
  const queue = await list.execute(marina, {});
  expect(queue.requests).toHaveLength(1);
  const card = queue.requests[0];
  expect(card).not.toHaveProperty("payload");
  expect(card?.type).toEqual({
    code: "enrollment",
    title: "Справка об обучении",
  });
  expect(card?.student).not.toHaveProperty("faculty");
  expect(queue.types).toEqual([
    { code: "enrollment", title: "Справка об обучении" },
  ]);
  expect(JSON.stringify(queue)).not.toContain("Учебный центр «Меридиан»");
  const detail = await get.execute(marina, { id });
  expect(detail.payload).toEqual({ destination: "Учебный центр «Меридиан»" });
  expect(detail.type.fields).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "destination" })]),
  );
});
it("каждый staff-сценарий отвергает студента до обращения к хранилищу", async () => {
  const spy = vi.spyOn(db, "listTypes");
  for (const operation of [
    () => list.execute(anna, {}),
    () => get.execute(anna, { id: "any" }),
    () => change.execute(anna, {}),
  ])
    await expect(operation()).rejects.toThrow(ForbiddenError);
  expect(spy).not.toHaveBeenCalled();
  expect(db.audit).toEqual([]);
});
it("факультеты из Actor ограничивают очередь, карточку и действие; черновик и неизвестный id скрыты", async () => {
  const own = await sent();
  const foreign = await sent(timur);
  if (marina.kind !== "staff") throw new Error("Нужен сотрудник");
  const limited = { ...marina, facultyIds: ["fmo"] };
  const draft = await create.execute(anna, {
    typeCode: "enrollment",
    payload: {},
  });
  expect(
    (await list.execute(limited, { facultyIds: ["imp"] })).requests.map(
      (r) => r.id,
    ),
  ).toEqual([own]);
  for (const id of [
    foreign,
    draft.id,
    "00000000-0000-7000-8000-999999999999",
    "invalid",
  ])
    await expect(get.execute(limited, { id })).rejects.toThrow(NotFoundError);
  await expect(
    change.execute(limited, { id: foreign, to: "accepted" }),
  ).rejects.toThrow(NotFoundError);
  expect(db.audit).toEqual([]);
});
it("фильтры URL нормализуются через zod, неизвестные поля и недопустимые значения игнорируются", () => {
  expect(
    parseStaffFilters({
      type: [],
      sla: "bad",
      scope: "other",
      q: "тайна",
      studentId: "other",
    }),
  ).toEqual({ type: "", sla: "all", scope: "all", q: "" });
  expect(
    parseStaffFilters({
      type: "enrollment",
      sla: "overdue",
      scope: "mine",
      q: " з-2026-000 ",
    }),
  ).toEqual({
    type: "enrollment",
    sla: "overdue",
    scope: "mine",
    q: "З-2026-000",
  });
});
it("очередь фильтруется и сортируется: просрочено, скоро, в срок; мои — только назначенные мне", async () => {
  const first = await sent(),
    second = await sent(),
    third = await sent();
  const [a, b, c] = db.requests.records;
  if (!a || !b || !c) throw new Error("Нет данных");
  a.dueAt = "2026-11-10T09:00:00Z";
  b.dueAt = "2026-11-03T09:00:00Z";
  c.dueAt = "2026-11-05T09:00:00Z";
  expect((await list.execute(marina, {})).requests.map((r) => r.id)).toEqual([
    second,
    third,
    first,
  ]);
  await change.execute(marina, { id: second, to: "accepted" });
  expect(
    (
      await list.execute(marina, {
        scope: "mine",
        sla: "overdue",
        type: "enrollment",
        q: b.publicNo,
      })
    ).requests.map((r) => r.id),
  ).toEqual([second]);
  expect((await list.execute(marina, { type: "visa" })).requests).toEqual([]);
});
it("архив содержит только выданные и отклонённые за последние семь дней; старую карточку можно открыть", async () => {
  const id = await sent();
  await change.execute(marina, {
    id,
    to: "rejected",
    comment: "Учебная причина",
  });
  clock.advance(7 * 86_400_000);
  expect((await list.execute(marina, {})).requests).toHaveLength(1);
  clock.advance(1);
  expect((await list.execute(marina, {})).requests).toEqual([]);
  expect((await get.execute(marina, { id })).status).toBe("rejected");
});
it("доступные действия соответствуют политике, прыжки и клиентские идентификаторы отвергаются", async () => {
  expect(allowedStaffActions("submitted")).toEqual(["accepted", "rejected"]);
  expect(allowedStaffActions("in_progress")).toEqual([
    "needs_info",
    "ready",
    "rejected",
  ]);
  expect(allowedStaffActions("needs_info")).toEqual([]);
  const id = await sent();
  await expect(change.execute(marina, { id, to: "ready" })).rejects.toThrow(
    ConflictError,
  );
  for (const extra of [
    { studentId: "other" },
    { userId: "other" },
    { staffId: "other" },
    { facultyIds: ["imp"] },
  ])
    await expect(
      change.execute(marina, { id, to: "accepted", ...extra }),
    ).rejects.toThrow(ValidationError);
  expect(db.audit).toEqual([]);
});
it("назначение, событие, уведомление, certificate и аудит сохраняются; Logger получает только код и user_id", async () => {
  const id = await sent();
  for (const to of ["accepted", "in_progress", "ready", "issued"])
    await change.execute(marina, { id, to });
  expect(db.requests.records[0]?.assignee).toBe("marina-staff");
  expect(db.requests.events).toHaveLength(5);
  expect(db.requests.notifications).toHaveLength(5);
  expect(db.requests.certificates).toHaveLength(1);
  expect(db.audit.map((e) => e.action)).toEqual([
    "request.accept",
    "request.start",
    "request.ready",
    "request.issue",
  ]);
  expect(Object.keys(db.audit[0] ?? {})).toEqual([
    "userId",
    "action",
    "entityId",
    "occurredAt",
  ]);
  expect(logger.info).toHaveBeenLastCalledWith("request.issue", {
    user_id: marina.userId,
  });
  const detail = await get.execute(marina, { id });
  expect(detail.audit).toHaveLength(4);
  expect(detail.events).toHaveLength(5);
  expect(JSON.stringify(detail)).not.toMatch(
    /studentId|studentUserId|facultyId|actorUserId/,
  );
});
it.each(["needs_info", "rejected"])(
  "%s требует комментарий, ошибка относится к полю",
  async (to) => {
    const id = await sent();
    await change.execute(marina, { id, to: "accepted" });
    await change.execute(marina, { id, to: "in_progress" });
    await expect(
      change.execute(marina, { id, to, comment: "  " }),
    ).rejects.toMatchObject({
      fieldErrors: { comment: ["Добавьте комментарий."] },
    });
    await change.execute(marina, {
      id,
      to,
      comment: "  Уточните место требования.  ",
    });
    expect(db.requests.events.at(-1)?.comment).toBe(
      "Уточните место требования.",
    );
  },
);
it("сбой аудита после вставки откатывает весь переход и certificate, Logger не сообщает об успехе", async () => {
  const id = await sent();
  await change.execute(marina, { id, to: "accepted" });
  await change.execute(marina, { id, to: "in_progress" });
  vi.clearAllMocks();
  db.failAudit = true;
  await expect(change.execute(marina, { id, to: "ready" })).rejects.toThrow(
    "Тестовый сбой аудита",
  );
  expect(db.requests.records[0]?.status).toBe("in_progress");
  expect(db.requests.events).toHaveLength(3);
  expect(db.requests.notifications).toHaveLength(3);
  expect(db.requests.certificates).toHaveLength(0);
  expect(db.audit).toHaveLength(2);
  expect(logger.info).not.toHaveBeenCalled();
});
