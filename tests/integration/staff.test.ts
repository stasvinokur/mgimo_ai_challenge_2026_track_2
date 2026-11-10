import { afterAll, beforeAll, expect, it } from "vitest";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/application/shared/errors";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import type { StaffTransaction } from "@/application/staff/ports";
import { openStaffFixture, type StaffFixture } from "./staff-fixtures";

let f: StaffFixture;
beforeAll(async () => {
  f = await openStaffFixture();
});
afterAll(async () => {
  await f?.close();
});

it("временный сотрудник одного факультета не читает и не меняет заявки другого факультета; Marina видит оба", async () => {
  const own = await f.request(),
    foreign = await f.request(f.timur),
    draft = await f.request(f.anna, true);
  await f.change.execute(f.marina, { id: foreign, to: "accepted" });
  const queue = await f.list.execute(f.limited, {
    facultyIds: f.marina.facultyIds,
  });
  expect(queue.requests.some((r) => r.id === own)).toBe(true);
  expect(queue.requests.some((r) => [foreign, draft].includes(r.id))).toBe(
    false,
  );
  for (const id of [foreign, draft, f.ids.next()])
    await expect(f.get.execute(f.limited, { id })).rejects.toThrow(
      NotFoundError,
    );
  if (f.limited.kind !== "staff") throw new Error("Нужен сотрудник");
  expect(
    await f.repo.listEventsForFaculties(foreign, f.limited.facultyIds),
  ).toEqual([]);
  expect(
    await f.repo.listAuditForFaculties(foreign, f.limited.facultyIds),
  ).toEqual([]);
  await expect(
    f.change.execute(f.limited, { id: foreign, to: "in_progress" }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    f.change.execute(f.anna, { id: own, to: "accepted" }),
  ).rejects.toThrow(ForbiddenError);
  expect((await f.get.execute(f.marina, { id: foreign })).status).toBe(
    "accepted",
  );
  expect(
    (await f.list.execute(f.marina, {})).requests.some((r) => r.id === foreign),
  ).toBe(true);
});
it("принятие назначает текущего сотрудника, фильтр мои отделяет ответственных, события и аудит возвращаются в DTO", async () => {
  const id = await f.request();
  await f.change.execute(f.limited, { id, to: "accepted" });
  if (f.limited.kind !== "staff") throw new Error("Нужен сотрудник");
  expect(
    (await f.sql`select assignee_staff_id from requests where id = ${id}`)[0]
      ?.assignee_staff_id,
  ).toBe(f.limited.staffId);
  expect(
    (await f.list.execute(f.limited, { scope: "mine" })).requests.some(
      (r) => r.id === id,
    ),
  ).toBe(true);
  expect(
    (await f.list.execute(f.marina, { scope: "mine" })).requests.some(
      (r) => r.id === id,
    ),
  ).toBe(false);
  const detail = await f.get.execute(f.limited, { id });
  expect(detail.student.fullName).toBeTruthy();
  expect(detail.student.group).toBeTruthy();
  expect(detail.events).toHaveLength(2);
  expect(detail.audit).toMatchObject([
    { action: "request.accept", staffName: "Учебный сотрудник" },
  ]);
});
it.each(["audit", "notifications", "certificates"] as const)(
  "отказ %s после вставки откатывает статус, событие, уведомление, certificate и аудит",
  async (part) => {
    const id = await f.request();
    await f.change.execute(f.marina, { id, to: "accepted" });
    await f.change.execute(f.marina, { id, to: "in_progress" });
    const failing: UnitOfWork<StaffTransaction> = {
      run: (work) =>
        f.uow.run((tx) => {
          const broken = { ...tx };
          if (part === "audit")
            broken.audit = {
              record: async (entry) => {
                await tx.audit.record(entry);
                throw new Error("Тестовый сбой");
              },
            };
          if (part === "notifications")
            broken.notifications = {
              add: async (entry) => {
                await tx.notifications.add(entry);
                throw new Error("Тестовый сбой");
              },
            };
          if (part === "certificates")
            broken.certificates = {
              create: async (entry) => {
                await tx.certificates.create(entry);
                throw new Error("Тестовый сбой");
              },
            };
          return work(broken);
        }),
    };
    const before = await f.get.execute(f.marina, { id });
    await expect(
      new ChangeStaffRequestStatus(failing, f.clock, f.ids, f.logger).execute(
        f.marina,
        { id, to: "ready" },
      ),
    ).rejects.toThrow("Тестовый сбой");
    expect(await f.get.execute(f.marina, { id })).toEqual(before);
    expect(
      await f.sql`select id from notifications where link = ${`/requests/${id}`}`,
    ).toHaveLength(3);
    expect(
      await f.sql`select id from certificates where request_id = ${id}`,
    ).toHaveLength(0);
  },
);
it("конкурентное принятие даёт ровно одно событие и запись аудита", async () => {
  const id = await f.request();
  const results = await Promise.allSettled([
    f.change.execute(f.marina, { id, to: "accepted" }),
    f.change.execute(f.limited, { id, to: "accepted" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: expect.any(ConflictError),
  });
  expect(
    await f.sql`select id from staff_audit_log where request_id = ${id}`,
  ).toHaveLength(1);
  expect(
    await f.sql`select id from request_events where request_id = ${id}`,
  ).toHaveLength(2);
});
it("SLA, тип и номер фильтруются, просроченные идут первыми, архив ограничен семью днями", async () => {
  const early = await f.request(),
    late = await f.request(),
    old = await f.request(),
    boundary = await f.request();
  await f.sql`update requests set due_at = ${new Date(f.clock.now().getTime() + 10 * 86_400_000).toISOString()} where id = ${early}`;
  await f.sql`update requests set due_at = ${new Date(f.clock.now().getTime() - 86_400_000).toISOString()} where id = ${late}`;
  for (const id of [old, boundary])
    await f.change.execute(f.marina, {
      id,
      to: "rejected",
      comment: "Учебная причина",
    });
  await f.sql`update requests set updated_at = ${new Date(f.clock.now().getTime() - 7 * 86_400_000 - 1).toISOString()} where id = ${old}`;
  await f.sql`update requests set updated_at = ${new Date(f.clock.now().getTime() - 7 * 86_400_000).toISOString()} where id = ${boundary}`;
  const queue = await f.list.execute(f.marina, {});
  expect(queue.requests.findIndex((r) => r.id === late)).toBeLessThan(
    queue.requests.findIndex((r) => r.id === early),
  );
  expect(queue.requests.some((r) => r.id === old)).toBe(false);
  expect(queue.requests.some((r) => r.id === boundary)).toBe(true);
  const detail = await f.get.execute(f.marina, { id: late });
  expect(
    (
      await f.list.execute(f.marina, {
        type: "enrollment",
        sla: "overdue",
        q: detail.publicNo,
      })
    ).requests.map((r) => r.id),
  ).toEqual([late]);
});
it("полный путь Тимура: готовый документ, трекер, уведомление и три записи аудита", async () => {
  const id = await f.request(f.timur);
  for (const to of ["accepted", "in_progress", "ready"])
    await f.change.execute(f.marina, { id, to });
  expect((await f.get.execute(f.marina, { id })).status).toBe("ready");
  expect(
    await f.sql`select id from certificates where request_id = ${id}`,
  ).toHaveLength(1);
  expect(
    await f.sql`select id from staff_audit_log where request_id = ${id}`,
  ).toHaveLength(3);
  expect(
    await f.sql`select id from notifications where user_id = ${f.timur.userId} and link = ${`/requests/${id}`} and title like '%Готова%'`,
  ).toHaveLength(1);
});
