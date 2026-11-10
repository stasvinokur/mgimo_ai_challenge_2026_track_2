import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Actor } from "@/application/ports/actor";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import type { RequestTransaction } from "@/application/requests/ports";
import { GetMyRequest } from "@/application/requests/queries";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "@/application/shared/errors";
import { staffCommentOptions } from "@/application/staff/dto";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import * as schema from "@/infrastructure/db/schema";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { cleanupRequestsForTest } from "./requests-e2e-cleanup";

const sql = createDatabase(10);
const uow = new DrizzleRequestsUnitOfWork(() => sql);
const repo = new DrizzleRequestRepository(() => drizzle(sql, { schema }));
const clock = new FakeClock("2026-11-06T09:00:00Z");
const ids = new UuidV7Generator();
const change = new ChangeRequestStatus(uow, clock, ids);
const submit = new SubmitRequest(change);
const create = new CreateRequestDraft(uow, clock, ids);
const get = new GetMyRequest(repo, clock);
let anna: Actor;
let timur: Actor;
let marina: Actor;
const created: string[] = [];
const studentIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  const identity = new PostgresIdentityRepository(() => sql);
  async function actor(login: string) {
    const user = await identity.findCredentials(login);
    const result = user && (await identity.findActorByUserId(user.userId));
    if (!result) throw new Error("Нужен демо-сид тестовой БД.");
    return result;
  }
  anna = await actor("anna");
  timur = await actor("timur");
  marina = await actor("marina");
});
afterAll(async () => {
  try {
    for (const id of created) {
      await sql`delete from notifications where link = ${`/requests/${id}`}`;
      await sql`delete from certificates where request_id = ${id}`;
      await sql`delete from requests where id = ${id}`;
    }
    for (const id of studentIds)
      await sql`delete from students where id = ${id}`;
    for (const id of userIds) await sql`delete from users where id = ${id}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
});
async function draft(owner: Actor = anna, destination = "По месту требования") {
  const result = await create.execute(owner, {
    typeCode: "enrollment",
    payload: { destination },
  });
  created.push(result.id);
  return result.id;
}

async function isolatedStudent(): Promise<Actor> {
  if (anna.kind !== "student") throw new Error("Нужен студент.");
  const id = ids.next();
  const userId = ids.next();
  await sql`insert into users (id, login, password_hash, role)
    select ${userId}, ${`requests-test-${userId}`}, password_hash, 'student'
    from users where id = ${anna.userId}`;
  userIds.push(userId);
  await sql`insert into students (id, user_id, full_name, faculty_id, program_id, course, group_id, record_book_no) select ${id}, ${userId}, 'Учебный студент', faculty_id, program_id, course, group_id, ${`ТЕСТ-${id}`} from students where id = ${anna.studentId}`;
  studentIds.push(id);
  return { ...anna, userId, studentId: id };
}

it("сотрудник не видит черновик своего факультета ни при чтении, ни при блокировке", async () => {
  const id = await draft();
  if (marina.kind !== "staff") throw new Error("Нужен сотрудник.");
  const faculties = marina.facultyIds;
  expect(await repo.findByIdForFaculties(id, faculties)).toBeNull();
  expect(
    await uow.run(({ requests }) =>
      requests.findByIdForFaculties(id, faculties, true),
    ),
  ).toBeNull();
  for (const target of [id, ids.next()])
    await expect(
      change.execute(marina, { id: target, to: "accepted" }),
    ).rejects.toThrow(NotFoundError);
  expect((await get.execute(anna, { id })).status).toBe("draft");
});
it("из двух конкурентных созданий при 19 черновиках проходит только двадцатое", async () => {
  const owner = await isolatedStudent();
  for (let i = 0; i < 19; i++) await draft(owner);
  const results = await Promise.allSettled([draft(owner), draft(owner)]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: expect.any(RateLimitedError),
  });
  if (owner.kind !== "student") throw new Error("Нужен студент.");
  expect(await repo.listForStudent(owner.studentId)).toHaveLength(20);
});
it("из двух конкурентных отправок при 19 за сутки проходит только двадцатая", async () => {
  const owner = await isolatedStudent();
  for (let i = 0; i < 19; i++) {
    const id = await draft(owner);
    await submit.execute(owner, { id });
    await change.execute(owner, { id, to: "cancelled" });
  }
  const first = await draft(owner),
    second = await draft(owner);
  const results = await Promise.allSettled([
    submit.execute(owner, { id: first }),
    submit.execute(owner, { id: second }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: expect.any(RateLimitedError),
  });
  if (owner.kind !== "student") throw new Error("Нужен студент.");
  const own = await repo.listForStudent(owner.studentId);
  expect(own.filter((record) => record.submittedAt)).toHaveLength(20);
  expect(own.filter((record) => record.status === "draft")).toHaveLength(1);
});
it("очистка e2e позволяет дважды отправить по 20 заявок на одной БД, сохраняя чужие строки", async () => {
  const owner = await isolatedStudent();
  const marker = `Тест повторного прогона · ${ids.next()}`;
  const untouched = await draft(owner);
  for (let round = 0; round < 2; round++) {
    try {
      for (let i = 0; i < 20; i++) {
        const id = await draft(owner, marker);
        await submit.execute(owner, { id });
      }
      const draftId = await draft(owner, marker);
      expect((await get.execute(owner, { id: draftId })).status).toBe("draft");
    } finally {
      await cleanupRequestsForTest(marker);
    }
    if (owner.kind !== "student") throw new Error("Нужен студент.");
    expect(
      (await repo.listForStudent(owner.studentId)).map((record) => record.id),
    ).toEqual([untouched]);
  }
});

it("репозиторий читает каталог из 9 типов и ограничивает заявку и события владельцем", async () => {
  expect(await repo.listTypes()).toHaveLength(9);
  const id = await draft();
  await submit.execute(anna, { id });
  expect(await get.execute(anna, { id })).toMatchObject({
    status: "submitted",
    dueAt: "2026-11-11T09:00:00.000Z",
  });
  await expect(get.execute(timur, { id })).rejects.toThrow(NotFoundError);
  if (timur.kind !== "student") throw new Error("Нужен студент.");
  expect(await repo.listEventsForStudent(id, timur.studentId)).toEqual([]);
  await expect(change.execute(timur, { id, to: "cancelled" })).rejects.toThrow(
    NotFoundError,
  );
  await expect(change.execute(anna, { id, to: "accepted" })).rejects.toThrow(
    ForbiddenError,
  );
  if (marina.kind !== "staff") throw new Error("Нужен сотрудник.");
  await expect(
    change.execute({ ...marina, facultyIds: [] }, { id, to: "accepted" }),
  ).rejects.toThrow(NotFoundError);
});
it("конкурентная отправка разных черновиков получает разные последовательные номера", async () => {
  const drafts = await Promise.all(Array.from({ length: 6 }, () => draft()));
  const sent = await Promise.all(
    drafts.map((id) => submit.execute(anna, { id })),
  );
  const numbers = sent
    .map((r) => Number(r.publicNo?.slice(7)))
    .sort((a, b) => a - b);
  expect(new Set(numbers).size).toBe(6);
  expect(numbers[5]).toBe((numbers[0] ?? 0) + 5);
  for (const id of drafts) {
    expect(
      await sql`select id from request_events where request_id = ${id}`,
    ).toHaveLength(1);
    expect(
      await sql`select id from notifications where link = ${`/requests/${id}`}`,
    ).toHaveLength(1);
  }
});
it("две отправки одного черновика дают один переход, событие и уведомление", async () => {
  const id = await draft();
  const result = await Promise.allSettled([
    submit.execute(anna, { id }),
    submit.execute(anna, { id }),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(result.find((r) => r.status === "rejected")).toMatchObject({
    reason: expect.any(ConflictError),
  });
  expect(
    await sql`select id from request_events where request_id = ${id}`,
  ).toHaveLength(1);
  expect(
    await sql`select id from notifications where link = ${`/requests/${id}`}`,
  ).toHaveLength(1);
});
it("статус, событие и уведомление откатываются вместе даже при отказе после вставки уведомления", async () => {
  const id = await draft();
  const failing: UnitOfWork<RequestTransaction> = {
    run: (work) =>
      uow.run((tx) =>
        work({
          ...tx,
          notifications: {
            add: async (input) => {
              await tx.notifications.add(input);
              throw new Error("Тестовый отказ уведомления");
            },
          },
        }),
      ),
  };
  const broken = new SubmitRequest(
    new ChangeRequestStatus(failing, clock, ids),
  );
  await expect(broken.execute(anna, { id })).rejects.toThrow("Тестовый отказ");
  expect(await get.execute(anna, { id })).toMatchObject({
    status: "draft",
    publicNo: null,
    events: [],
  });
  expect(
    await sql`select id from notifications where link = ${`/requests/${id}`}`,
  ).toHaveLength(0);
});
it("полный путь с уточнением, certificate и уведомлением при каждом переходе", async () => {
  const id = await draft();
  await submit.execute(anna, { id });
  await change.execute(marina, { id, to: "accepted" });
  await change.execute(marina, { id, to: "in_progress" });
  await change.execute(marina, {
    id,
    to: "needs_info",
    commentCode: staffCommentOptions.needs_info[0].code,
  });
  await change.execute(anna, {
    id,
    to: "in_progress",
    comment: "В учебный центр «Горизонт»",
  });
  await change.execute(marina, { id, to: "ready" });
  await change.execute(marina, { id, to: "issued" });
  const detail = await get.execute(anna, { id });
  expect(detail.status).toBe("issued");
  expect(detail.events).toHaveLength(7);
  expect(detail.assignee).toBeTruthy();
  expect(detail.events[4]?.comment).toBe("В учебный центр «Горизонт»");
  expect(detail.events[3]?.comment).toBe(
    staffCommentOptions.needs_info[0].label,
  );
  const [certificate] =
    await sql`select number, verify_code from certificates where request_id = ${id}`;
  expect(certificate?.number).toBe(detail.publicNo?.replace(/^З-/, "С-"));
  expect(certificate?.verify_code).toMatch(/^[A-Z2-7]{26}$/);
  expect(
    await sql`select id from notifications where link = ${`/requests/${id}`}`,
  ).toHaveLength(7);
});
