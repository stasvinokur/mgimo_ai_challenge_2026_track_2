import { afterEach, beforeEach, expect, it } from "vitest";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import { ConflictError } from "@/application/shared/errors";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import type { StaffTransaction } from "@/application/staff/ports";
import { EVENT_ACTIVITY_POINTS } from "@/domain/requests/event-release";
import { createRequestTransaction } from "@/infrastructure/db/repositories/requests/unit-of-work";
import {
  type EventRequestFixture,
  openEventRequestFixture,
} from "./requests-event-data";

let f: EventRequestFixture;
beforeEach(async () => {
  f = await openEventRequestFixture();
});
afterEach(async () => {
  await f?.close();
});

function staffChange(uow: UnitOfWork<StaffTransaction>) {
  return new ChangeStaffRequestStatus(uow, f.clock, f.ids, f.logger);
}
async function effects(id: string) {
  return {
    marks:
      await f.sql`select * from attendance_records where source_key = ${`event:${id}`}`,
    points:
      await f.sql`select * from activity_points where source_key = ${`event:${id}`}`,
    notices:
      await f.sql`select * from notifications where link = ${`/requests/${id}`} and title like 'Освобождение одобрено:%'`,
    events:
      await f.sql`select * from request_events where request_id = ${id} and to_status = 'ready'`,
    audit:
      await f.sql`select * from staff_audit_log where request_id = ${id} and action = 'request.ready'`,
  };
}
it.each(["version", "notification", "audit"] as const)(
  "одна транзакция: сбой %s после отметок откатывает всё; повтор создаёт один набор",
  async (failure) => {
    const id = await f.createEvent();
    await f.progress(id);
    const lessons = await f.preview.execute(f.anna, {
      dateFrom: f.payload.dateFrom,
      dateTo: f.payload.dateTo,
    });
    expect(lessons.length).toBeGreaterThan(0);
    let reached = false;
    const broken: UnitOfWork<StaffTransaction> = {
      run: (work) =>
        f.uow.run(async (tx) => {
          if (!tx.eventRelease || f.anna.kind !== "student")
            throw new Error("Нет транзакционного порта");
          const port = tx.eventRelease.attendance;
          const marked: Awaited<
            ReturnType<typeof port.markExcusedForStudent>
          >[] = [];
          const awarded: Parameters<typeof port.awardActivityForStudent>[] = [];
          const eventRelease: NonNullable<StaffTransaction["eventRelease"]> = {
            schedule: tx.eventRelease.schedule,
            attendance: {
              markExcusedForStudent: async (studentId, lesson, input) => {
                const result = await port.markExcusedForStudent(
                  studentId,
                  lesson,
                  input,
                );
                marked.push(result);
                return result;
              },
              awardActivityForStudent: async (studentId, input) => {
                await port.awardActivityForStudent(studentId, input);
                awarded.push([studentId, input]);
              },
            },
          };
          const assertMarks = () => {
            expect(marked).toHaveLength(lessons.length);
            for (const row of marked)
              expect(row).toMatchObject({
                sourceKey: `event:${id}`,
                status: "excused",
                reason: f.payload.eventName,
              });
            expect(awarded).toEqual([
              [
                f.anna.kind === "student" ? f.anna.studentId : "",
                {
                  sourceKey: `event:${id}`,
                  points: EVENT_ACTIVITY_POINTS,
                  createdAt: f.clock.now().toISOString(),
                },
              ],
            ]);
            reached = true;
          };
          const requests = new Proxy(tx.requests, {
            get(target, key) {
              if (key === "save" && failure === "version")
                return async (...args: Parameters<typeof target.save>) => {
                  assertMarks();
                  return target.save(
                    args[0],
                    { ...args[1], updatedAt: "2019-01-01T00:00:00.000Z" },
                    args[2],
                  );
                };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          return work({
            ...tx,
            eventRelease,
            requests,
            notifications: {
              add: async (input) => {
                await tx.notifications.add(input);
                if (failure === "notification") {
                  assertMarks();
                  throw new Error("Тестовый отказ уведомления");
                }
              },
            },
            audit: {
              record: async (entry) => {
                await tx.audit.record(entry);
                if (failure === "audit") {
                  assertMarks();
                  throw new Error("Тестовый отказ аудита");
                }
              },
            },
          });
        }),
    };
    await expect(
      staffChange(broken).execute(f.limited, { id, to: "ready" }),
    ).rejects.toThrow(failure === "version" ? ConflictError : "Тестовый отказ");
    expect(reached).toBe(true);
    expect((await f.get.execute(f.anna, { id })).status).toBe("in_progress");
    expect(await effects(id)).toEqual({
      marks: [],
      points: [],
      notices: [],
      events: [],
      audit: [],
    });
    await staffChange(f.uow).execute(f.limited, { id, to: "ready" });
    const result = await effects(id);
    expect(result.marks).toHaveLength(lessons.length);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.points).toBe(EVENT_ACTIVITY_POINTS);
    expect(result.notices).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.audit).toHaveLength(1);
    await expect(
      staffChange(f.uow).execute(f.limited, { id, to: "ready" }),
    ).rejects.toThrow(ConflictError);
    await staffChange(f.uow).execute(f.limited, { id, to: "issued" });
    expect(await effects(id)).toEqual(result);
  },
);
it.each(["rejected", "needs_info"] as const)(
  "после неудачного одобрения %s не оставляет отметок и баллов",
  async (to) => {
    const id = await f.createEvent();
    await f.progress(id);
    const broken: UnitOfWork<StaffTransaction> = {
      run: (work) =>
        f.uow.run((tx) =>
          work({
            ...tx,
            audit: {
              record: async (entry) => {
                await tx.audit.record(entry);
                throw new Error("Тестовый отказ аудита");
              },
            },
          }),
        ),
    };
    await expect(
      staffChange(broken).execute(f.limited, { id, to: "ready" }),
    ).rejects.toThrow("Тестовый отказ");
    await f.change.execute(f.limited, {
      id,
      to,
      comment: "Нужно подтверждение участия",
    });
    expect((await f.get.execute(f.anna, { id })).status).toBe(to);
    expect(await effects(id)).toEqual({
      marks: [],
      points: [],
      notices: [],
      events: [],
      audit: [],
    });
  },
);
it("raw SQL текущей транзакции получает Date после создания drizzle-репозиториев", async () => {
  const at = new Date("2026-11-05T08:30:00.000Z");
  await f.sql.begin(async (raw) => {
    const tx = createRequestTransaction(raw, f.ids, f.sql.options);
    expect(Object.keys(tx.eventRelease?.attendance ?? {}).sort()).toEqual([
      "awardActivityForStudent",
      "markExcusedForStudent",
    ]);
    const [row] = await raw<
      { at: Date }[]
    >`select ${at.toISOString()}::timestamptz as at`;
    expect(row?.at).toBeInstanceOf(Date);
    expect(row?.at.toISOString()).toBe(at.toISOString());
  });
});
