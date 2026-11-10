import { beforeEach, expect, it } from "vitest";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import {
  CreateRequestDraft,
  DeleteRequestDraft,
  UpdateRequestDraft,
} from "@/application/requests/drafts";
import {
  CheckRequestPayload,
  GetMyRequest,
  GetRequestCatalog,
  ListMyRequests,
} from "@/application/requests/queries";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina, timur } from "../fakes/identity";
import { enrollmentType, FakeRequests } from "../fakes/requests";

const clock = new FakeClock("2026-10-30T09:00:00Z");
let db: FakeRequests;
let create: CreateRequestDraft;
let update: UpdateRequestDraft;
let change: ChangeRequestStatus;
let submit: SubmitRequest;
let get: GetMyRequest;
beforeEach(() => {
  clock.set("2026-10-30T09:00:00Z");
  db = new FakeRequests();
  const ids = new SequentialIdGenerator();
  create = new CreateRequestDraft(db, clock, ids);
  update = new UpdateRequestDraft(db, clock);
  change = new ChangeRequestStatus(db, clock, ids);
  submit = new SubmitRequest(change);
  get = new GetMyRequest(db, clock);
});
async function draft(payload = { destination: "Учебный центр «Горизонт»" }) {
  return create.execute(anna, { typeCode: "enrollment", payload });
}

it("черновик хранится без публичного номера и срока; отправка назначает номер и SLA", async () => {
  const { id } = await draft();
  expect(await get.execute(anna, { id })).toMatchObject({
    status: "draft",
    publicNo: null,
    dueAt: null,
    events: [],
  });
  const result = await submit.execute(anna, { id });
  expect(result).toMatchObject({
    status: "submitted",
    publicNo: "З-2026-000001",
    dueAt: "2026-11-04T09:00:00.000Z",
  });
  expect(db.events).toHaveLength(1);
  expect(db.notifications).toHaveLength(1);
  await expect(submit.execute(anna, { id })).rejects.toThrow(ConflictError);
  expect(db.events).toHaveLength(1);
});
it("неполный черновик можно сохранить и исправить; отправить нельзя", async () => {
  const { id } = await draft({ destination: "" });
  await expect(submit.execute(anna, { id })).rejects.toThrow(ValidationError);
  expect(db.events).toHaveLength(0);
  await update.execute(anna, {
    id,
    payload: { destination: "По месту требования" },
  });
  await submit.execute(anna, { id });
  await expect(update.execute(anna, { id, payload: {} })).rejects.toThrow(
    ConflictError,
  );
});
it.each([
  {},
  { destination: "   " },
  { destination: 12 },
  { destination: "x".repeat(501) },
])(
  "отправка проверяет сохранённый payload и не меняет черновик при ошибке",
  async (payload) => {
    const { id } = await draft();
    const record = db.records[0];
    if (!record) throw new Error("Нет черновика.");
    record.payload = payload;
    const before = structuredClone(record);
    await expect(change.execute(anna, { id, to: "submitted" })).rejects.toThrow(
      ValidationError,
    );
    await expect(submit.execute(anna, { id })).rejects.toThrow(ValidationError);
    expect(db.records[0]).toEqual(before);
    expect(db.events).toHaveLength(0);
    expect(db.notifications).toHaveLength(0);
  },
);
it("сотрудник не отличает черновик своего факультета от отсутствующей заявки", async () => {
  const { id } = await draft();
  for (const target of [id, "00000000-0000-7000-8000-999999999999"])
    await expect(
      change.execute(marina, { id: target, to: "accepted" }),
    ).rejects.toThrow(NotFoundError);
  expect((await get.execute(anna, { id })).status).toBe("draft");
});
it("20 открытых черновиков можно создать, 21-й отклоняется; изменение и удаление доступны", async () => {
  for (let i = 0; i < 20; i++) await draft();
  expect(db.records).toHaveLength(20);
  await expect(draft()).rejects.toBeInstanceOf(RateLimitedError);
  await expect(draft()).rejects.toThrow(
    "Слишком много черновиков: удалите ненужные или отправьте готовые.",
  );
  expect(db.records).toHaveLength(20);
  const id = db.records[0]?.id;
  if (!id) throw new Error("Нет черновика.");
  await update.execute(anna, { id, payload: { destination: "Уточнение" } });
  await new DeleteRequestDraft(db).execute(anna, { id });
  await draft();
  expect(db.records).toHaveLength(20);
  await create.execute(timur, { typeCode: "enrollment", payload: {} });
  expect(db.records).toHaveLength(21);
});
it("20 отправок за сутки разрешены, 21-я запрещена даже после отмены; чужие отправки не учитываются", async () => {
  for (let i = 0; i < 20; i++) {
    const { id } = await draft();
    await submit.execute(anna, { id });
    await change.execute(anna, { id, to: "cancelled" });
  }
  const { id } = await draft();
  const before = await get.execute(anna, { id });
  await expect(
    change.execute(anna, { id, to: "submitted" }),
  ).rejects.toBeInstanceOf(RateLimitedError);
  await expect(submit.execute(anna, { id })).rejects.toThrow(
    "Вы уже отправили 20 заявок за 24 часа. Попробуйте позже.",
  );
  expect(await get.execute(anna, { id })).toEqual(before);
  expect(db.events).toHaveLength(40);
  expect(db.notifications).toHaveLength(40);
  const other = await create.execute(timur, {
    typeCode: "enrollment",
    payload: { destination: "По месту требования" },
  });
  await expect(submit.execute(timur, other)).resolves.toMatchObject({
    status: "submitted",
  });
});
it("отправки освобождают суточный лимит ровно через 24 часа", async () => {
  for (let i = 0; i < 20; i++) {
    const { id } = await draft();
    await submit.execute(anna, { id });
  }
  const next = await draft();
  clock.advance(86_400_000 - 1);
  await expect(submit.execute(anna, next)).rejects.toThrow(RateLimitedError);
  clock.advance(1);
  await expect(submit.execute(anna, next)).resolves.toMatchObject({
    status: "submitted",
  });
});
it("у старой визовой схемы подпись страны очищена от повторной необязательности", async () => {
  db.types = [
    {
      ...enrollmentType,
      fieldsSchema: {
        type: "object",
        properties: {
          country: { type: "string", title: "Страна (если известна)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  ];
  expect(
    (await new GetRequestCatalog(db).execute(anna)).types[0]?.fields,
  ).toMatchObject([{ title: "Страна", required: false }]);
});
it("проверка полей возвращает ошибки у поля, сохраняет кавычки и не дополняет optional-поля", async () => {
  const check = new CheckRequestPayload(db, clock);
  await expect(
    check.execute(anna, {
      typeCode: "enrollment",
      payload: { destination: "  " },
    }),
  ).rejects.toMatchObject({
    fieldErrors: { destination: ["requestRequired"] },
  });
  const payload = { destination: "Центр «Горизонт»" };
  await expect(
    check.execute(anna, { typeCode: "enrollment", payload: {} }),
  ).rejects.toMatchObject({
    fieldErrors: { destination: ["requestRequired"] },
  });
  expect(
    await check.execute(anna, { typeCode: "enrollment", payload }),
  ).toEqual(payload);
  for (const extra of [
    { studentId: "other" },
    { userId: "other" },
    { groupId: "other" },
    { unknown: 12 },
  ])
    await expect(
      check.execute(anna, {
        typeCode: "enrollment",
        payload: { ...payload, ...extra },
      }),
    ).rejects.toThrow(ValidationError);
  await expect(
    create.execute(anna, {
      typeCode: "enrollment",
      payload,
      studentId: "other",
    }),
  ).rejects.toThrow(ValidationError);
  await expect(
    check.execute(anna, {
      typeCode: "enrollment",
      payload: { destination: "x".repeat(501) },
    }),
  ).rejects.toThrow(ValidationError);
});
it("IDOR: чужой и отсутствующий id одинаково недоступны для чтения, изменения, отправки, удаления и перехода", async () => {
  const { id } = await draft();
  const missing = "00000000-0000-7000-8000-999999999999";
  for (const foreignId of [id, missing]) {
    for (const operation of [
      () => get.execute(timur, { id: foreignId }),
      () => update.execute(timur, { id: foreignId, payload: {} }),
      () => submit.execute(timur, { id: foreignId }),
      () => new DeleteRequestDraft(db).execute(timur, { id: foreignId }),
      () => change.execute(timur, { id: foreignId, to: "cancelled" }),
    ])
      await expect(operation()).rejects.toThrow(NotFoundError);
  }
  expect(await new ListMyRequests(db, clock).execute(timur)).toEqual([]);
  expect(db.records).toHaveLength(1);
  expect(db.events).toHaveLength(0);
});
it("сотрудник ограничен факультетом; студент не может выполнить staff-переход", async () => {
  const { id } = await draft();
  await submit.execute(anna, { id });
  await expect(change.execute(anna, { id, to: "accepted" })).rejects.toThrow(
    ForbiddenError,
  );
  await expect(
    change.execute(
      {
        kind: "staff",
        userId: marina.userId,
        staffId: "marina-staff",
        facultyIds: ["other"],
      },
      { id, to: "accepted" },
    ),
  ).rejects.toThrow(NotFoundError);
  await change.execute(marina, { id, to: "accepted" });
  await change.execute(marina, { id, to: "in_progress" });
  await expect(
    change.execute(marina, { id, to: "needs_info" }),
  ).rejects.toThrow(ValidationError);
  await change.execute(marina, {
    id,
    to: "needs_info",
    comment: "Уточните место получения",
  });
  await expect(
    change.execute(anna, { id, to: "in_progress", comment: "  " }),
  ).rejects.toThrow(ValidationError);
  await change.execute(anna, { id, to: "in_progress", comment: "В деканате" });
  await change.execute(marina, { id, to: "ready" });
  await change.execute(marina, { id, to: "issued" });
  expect(db.events).toHaveLength(7);
  expect(db.notifications).toHaveLength(7);
  expect(db.certificates).toHaveLength(1);
  await expect(change.execute(anna, { id, to: "cancelled" })).rejects.toThrow(
    ConflictError,
  );
});
it("отмена доступна только для поданной; удаляется только черновик", async () => {
  const { id } = await draft();
  await submit.execute(anna, { id });
  await change.execute(anna, { id, to: "cancelled" });
  await expect(
    new DeleteRequestDraft(db).execute(anna, { id }),
  ).rejects.toThrow(ConflictError);
  const other = await draft();
  await new DeleteRequestDraft(db).execute(anna, other);
  await expect(get.execute(anna, other)).rejects.toThrow(NotFoundError);
});
it("сбой уведомления откатывает статус, номер и событие", async () => {
  const { id } = await draft();
  db.failNotification = true;
  await expect(submit.execute(anna, { id })).rejects.toThrow("Тестовый отказ");
  expect(db.records[0]).toMatchObject({
    status: "draft",
    publicNo: `draft:${id}`,
  });
  expect(db.events).toHaveLength(0);
  expect(db.notifications).toHaveLength(0);
});
it("все студенческие сценарии проверяют роль самостоятельно; каталог подставляет свой профиль", async () => {
  expect((await new GetRequestCatalog(db).execute(anna)).profile.fullName).toBe(
    "Анна Соколова",
  );
  const { id } = await draft();
  for (const operation of [
    () => create.execute(marina, {}),
    () => update.execute(marina, {}),
    () => submit.execute(marina, { id }),
    () => new DeleteRequestDraft(db).execute(marina, { id }),
    () => get.execute(marina, { id }),
    () => new GetRequestCatalog(db).execute(marina),
    () => new ListMyRequests(db, clock).execute(marina),
    () => new CheckRequestPayload(db, clock).execute(marina, {}),
  ])
    await expect(operation()).rejects.toThrow(ForbiddenError);
  const dto = await get.execute(anna, { id });
  expect(JSON.stringify(dto)).not.toMatch(
    /studentId|studentUserId|facultyId|actorUserId/,
  );
});
