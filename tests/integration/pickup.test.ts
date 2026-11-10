import { afterEach, beforeEach, expect, it } from "vitest";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import { BookRequestPickup } from "@/application/requests/pickup";
import type { RequestTransaction } from "@/application/requests/ports";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "@/application/shared/errors";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import { ChangeStaffPickup } from "@/application/staff/pickup";
import type { StaffTransaction } from "@/application/staff/ports";
import { openPickupFixture, type PickupFixture } from "./pickup-data";

let f: PickupFixture;
beforeEach(async () => {
  f = await openPickupFixture();
  f.clock.set("2026-11-09T06:00:00.000Z");
});
afterEach(async () => {
  await f?.close();
});

const slotStartsAt = "2026-11-09T08:00:00.000Z";

it("две параллельные PostgreSQL-транзакции: один слот достаётся одному студенту, проигравший получает понятный конфликт", async () => {
  const first = await f.ready(),
    second = await f.ready(f.second);
  let entered = 0;
  let release: (() => void) | undefined;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent: UnitOfWork<RequestTransaction> = {
    run: (work) =>
      f.requestUow.run(async (tx) => {
        if (!tx.pickup) throw new Error("Нет транзакционного порта очереди");
        const pickup = new Proxy(tx.pickup, {
          get(target, key) {
            if (key === "lockTicketDays")
              return async (
                ...args: Parameters<typeof target.lockTicketDays>
              ) => {
                entered += 1;
                if (entered === 2) release?.();
                await both;
                return target.lockTicketDays(...args);
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return work({ ...tx, pickup });
      }),
  };
  const book = new BookRequestPickup(concurrent, f.clock, f.ids, f.limiter);
  const results = await Promise.allSettled([
    book.execute(f.anna, { id: first, windowId: f.windowId, slotStartsAt }),
    book.execute(f.second, { id: second, windowId: f.windowId, slotStartsAt }),
  ]);
  expect(entered).toBe(2);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failed = results.find((result) => result.status === "rejected");
  expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(
    ConflictError,
  );
  expect(failed?.status === "rejected" && failed.reason.message).toMatch(
    /слот|занят|время/i,
  );
  expect(
    await f.sql`select id from pickup_bookings where window_id = ${f.windowId} and slot_starts_at = ${slotStartsAt} and status in ('booked', 'called')`,
  ).toHaveLength(1);
});

it("перенос атомарен, активная запись одна; отмена освобождает слот, номера талонов не повторяются", async () => {
  const id = await f.ready();
  const initial = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt,
  });
  const otherId = await f.ready(f.second);
  const occupied = await f.book.execute(f.second, {
    id: otherId,
    windowId: f.windowId,
    slotStartsAt: "2026-11-09T08:10:00.000Z",
  });
  await expect(
    f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt: occupied.slotStartsAt,
    }),
  ).rejects.toThrow(ConflictError);
  expect((await f.getPickup.execute(f.anna, { id })).booking?.id).toBe(
    initial.id,
  );
  const moved = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt: "2026-11-09T08:20:00.000Z",
  });
  expect(moved.ticketNo).not.toBe(initial.ticketNo);
  expect(
    await f.sql`select id from pickup_bookings where request_id = ${id} and status in ('booked', 'called')`,
  ).toHaveLength(1);
  await f.cancel.execute(f.anna, { id: moved.id });
  const replacement = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt,
  });
  expect(
    new Set([
      initial.ticketNo,
      occupied.ticketNo,
      moved.ticketNo,
      replacement.ticketNo,
    ]).size,
  ).toBe(4);
  f.clock.set(slotStartsAt);
  await expect(
    f.cancel.execute(f.anna, { id: replacement.id }),
  ).rejects.toThrow(ConflictError);
});

it("IDOR, роль и факультет: чужая заявка/талон скрыты, очередь отсортирована по времени", async () => {
  const id = await f.ready(),
    foreignId = await f.ready(f.timur);
  const own = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt,
  });
  const foreign = await f.book.execute(f.timur, {
    id: foreignId,
    windowId: f.foreignWindowId,
    slotStartsAt,
  });
  await expect(f.getPickup.execute(f.timur, { id })).rejects.toThrow(
    NotFoundError,
  );
  await expect(f.cancel.execute(f.timur, { id: own.id })).rejects.toThrow(
    NotFoundError,
  );
  await expect(
    f.book.execute(f.anna, { id, windowId: f.foreignWindowId, slotStartsAt }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    f.changePickup.execute(f.limited, { id: foreign.id, to: "called" }),
  ).rejects.toThrow(NotFoundError);
  await expect(f.listPickup.execute(f.anna)).rejects.toThrow(ForbiddenError);
  const teacher = {
    kind: "teacher" as const,
    userId: f.ids.next(),
    teacherId: f.ids.next(),
  };
  await expect(f.listPickup.execute(teacher)).rejects.toThrow(ForbiddenError);
  await expect(
    f.changePickup.execute(teacher, { id: own.id, to: "called" }),
  ).rejects.toThrow(ForbiddenError);
  const earlyId = await f.ready(f.second);
  const early = await f.book.execute(f.second, {
    id: earlyId,
    windowId: f.windowId,
    slotStartsAt: "2026-11-09T07:00:00.000Z",
  });
  const queue = await f.listPickup.execute(f.limited);
  expect(
    queue
      .filter((item) => [early.id, own.id].includes(item.id))
      .map((item) => item.id),
  ).toEqual([early.id, own.id]);
  expect(queue.some((item) => item.id === foreign.id)).toBe(false);
});

async function issuedEffects(id: string) {
  return {
    request: await f.sql`select status from requests where id = ${id}`,
    bookings:
      await f.sql`select status from pickup_bookings where request_id = ${id}`,
    events:
      await f.sql`select id from request_events where request_id = ${id} and to_status = 'issued'`,
    notifications:
      await f.sql`select id from notifications where link = ${`/requests/${id}`}`,
    audit: await f.sql`select id from staff_audit_log where request_id = ${id}`,
  };
}

it.each(["notification", "audit"] as const)(
  "выдача: сбой %s откатывает талон, статус, событие, уведомление и аудит",
  async (failure) => {
    const id = await f.ready();
    const ticket = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt,
    });
    const before = await issuedEffects(id);
    let reached = false;
    const broken: UnitOfWork<StaffTransaction> = {
      run: (work) =>
        f.uow.run((tx) =>
          work({
            ...tx,
            notifications: {
              add: async (input) => {
                await tx.notifications.add(input);
                if (failure === "notification") {
                  reached = true;
                  throw new Error("Тестовый отказ уведомления");
                }
              },
            },
            audit: {
              record: async (input) => {
                await tx.audit.record(input);
                if (failure === "audit") {
                  reached = true;
                  throw new Error("Тестовый отказ аудита");
                }
              },
            },
          }),
        ),
    };
    await expect(
      new ChangeStaffPickup(broken, f.clock, f.ids, f.logger).execute(
        f.limited,
        { id: ticket.id, to: "served" },
      ),
    ).rejects.toThrow("Тестовый отказ");
    expect(reached).toBe(true);
    expect(await issuedEffects(id)).toEqual(before);
    await f.changePickup.execute(f.limited, { id: ticket.id, to: "served" });
    const after = await issuedEffects(id);
    expect(after.request).toEqual([{ status: "issued" }]);
    expect(after.bookings).toEqual([{ status: "served" }]);
    expect(after.events).toHaveLength(1);
    expect(after.notifications.length).toBe(before.notifications.length + 1);
    expect(after.audit).toHaveLength(1);
    await expect(
      f.changePickup.execute(f.limited, { id: ticket.id, to: "served" }),
    ).rejects.toThrow(ConflictError);
    expect(await issuedEffects(id)).toEqual(after);
  },
);

it("обычная staff-выдача завершает активный талон в той же транзакции; вызов меняет pulse через уведомление", async () => {
  const id = await f.ready();
  const ticket = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt,
  });
  const before =
    await f.sql`select id from notifications where user_id = ${f.anna.userId}`;
  await f.changePickup.execute(f.limited, { id: ticket.id, to: "called" });
  expect((await f.getPickup.execute(f.anna, { id })).booking?.status).toBe(
    "called",
  );
  expect(
    (await f.sql`select id from notifications where user_id = ${f.anna.userId}`)
      .length,
  ).toBe(before.length + 1);
  const change = new ChangeStaffRequestStatus(f.uow, f.clock, f.ids, f.logger);
  await change.execute(f.limited, { id, to: "issued" });
  expect(
    await f.sql`select status from pickup_bookings where id = ${ticket.id}`,
  ).toEqual([{ status: "served" }]);
  expect((await issuedEffects(id)).events).toHaveLength(1);
});

it("неявка освобождает слот и оставляет заявку готовой; новый талон получает следующий номер", async () => {
  const id = await f.ready();
  const ticket = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt,
  });
  await expect(
    f.changePickup.execute(f.limited, { id: ticket.id, to: "no_show" }),
  ).rejects.toThrow(ConflictError);
  f.clock.set(slotStartsAt);
  await f.changePickup.execute(f.limited, { id: ticket.id, to: "no_show" });
  expect(await f.sql`select status from requests where id = ${id}`).toEqual([
    { status: "ready" },
  ]);
  expect(
    await f.sql`select status from pickup_bookings where id = ${ticket.id}`,
  ).toEqual([{ status: "no_show" }]);
  expect((await f.getPickup.execute(f.anna, { id })).booking).toBeNull();
  const rebooked = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt: "2026-11-09T08:10:00.000Z",
  });
  expect(rebooked.ticketNo).not.toBe(ticket.ticketNo);
  await f.changePickup.execute(f.limited, { id: rebooked.id, to: "called" });
  await expect(
    f.changePickup.execute(f.limited, { id: rebooked.id, to: "called" }),
  ).rejects.toThrow(ConflictError);
  await f.cancel.execute(f.anna, { id: rebooked.id });
  expect(
    await f.sql`select status from pickup_bookings where id = ${rebooked.id}`,
  ).toEqual([{ status: "cancelled" }]);
});

it.each(["booked", "called"] as const)(
  "вчерашний талон %s закрывается как no_show при новой записи, история и готовая заявка сохраняются",
  async (status) => {
    const id = await f.ready();
    const previous = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt,
    });
    if (status === "called")
      await f.changePickup.execute(f.limited, {
        id: previous.id,
        to: "called",
      });
    const original = await f.pickup.findByIdForStudent(
      previous.id,
      f.anna.studentId,
    );
    const before = await issuedEffects(id);
    f.clock.set("2026-11-10T06:00:00.000Z");
    expect((await f.getPickup.execute(f.anna, { id })).booking).toMatchObject({
      id: previous.id,
      status: "no_show",
      canCancel: false,
    });
    expect(
      await f.sql`select status from pickup_bookings where id = ${previous.id}`,
    ).toEqual([{ status }]);
    const next = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt: "2026-11-10T08:00:00.000Z",
    });
    expect(next.id).not.toBe(previous.id);
    expect(next.status).toBe("booked");
    expect(
      await f.pickup.findByIdForStudent(previous.id, f.anna.studentId),
    ).toEqual({ ...original, status: "no_show" });
    expect(
      await f.sql`select id, status from pickup_bookings where request_id = ${id} order by slot_starts_at, id`,
    ).toEqual([
      { id: previous.id, status: "no_show" },
      { id: next.id, status: "booked" },
    ]);
    expect((await f.getPickup.execute(f.anna, { id })).booking?.id).toBe(
      next.id,
    );
    const after = await issuedEffects(id);
    expect(after.request).toEqual([{ status: "ready" }]);
    expect(after.events).toEqual(before.events);
    expect(after.notifications).toEqual(before.notifications);
    expect(after.audit).toEqual(before.audit);
  },
);

it.each(["booked", "called"] as const)(
  "сбой вставки нового талона откатывает закрытие вчерашнего %s",
  async (status) => {
    const id = await f.ready();
    const previous = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt,
    });
    if (status === "called")
      await f.changePickup.execute(f.limited, {
        id: previous.id,
        to: "called",
      });
    const before = await issuedEffects(id);
    f.clock.set("2026-11-10T06:00:00.000Z");
    let inserted = false;
    const broken: UnitOfWork<RequestTransaction> = {
      run: (work) =>
        f.requestUow.run(async (tx) => {
          if (!tx.pickup) throw new Error("Нет транзакционного порта очереди");
          const pickup = new Proxy(tx.pickup, {
            get(target, key) {
              if (key === "insert")
                return async (...args: Parameters<typeof target.insert>) => {
                  await target.insert(...args);
                  inserted = true;
                  throw new Error("Тестовый отказ после вставки талона");
                };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          return work({ ...tx, pickup });
        }),
    };
    const book = new BookRequestPickup(broken, f.clock, f.ids, f.limiter);
    await expect(
      book.execute(f.anna, {
        id,
        windowId: f.windowId,
        slotStartsAt: "2026-11-10T08:00:00.000Z",
      }),
    ).rejects.toThrow("Тестовый отказ после вставки талона");
    expect(inserted).toBe(true);
    expect(await issuedEffects(id)).toEqual(before);
    expect(
      await f.sql`select id, status from pickup_bookings where request_id = ${id}`,
    ).toEqual([{ id: previous.id, status }]);
  },
);

it("два просроченных талона конкурируют за один новый слот: один успех, у проигравшего закрытие откатывается", async () => {
  const first = await f.ready(),
    second = await f.ready(f.second);
  const previous = [
    await f.book.execute(f.anna, {
      id: first,
      windowId: f.windowId,
      slotStartsAt,
    }),
    await f.book.execute(f.second, {
      id: second,
      windowId: f.windowId,
      slotStartsAt: "2026-11-09T08:10:00.000Z",
    }),
  ];
  const secondTicket = previous[1];
  if (!secondTicket) throw new Error("Нет второго талона");
  await f.changePickup.execute(f.limited, {
    id: secondTicket.id,
    to: "called",
  });
  f.clock.set("2026-11-10T06:00:00.000Z");
  let entered = 0;
  let release: (() => void) | undefined;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent: UnitOfWork<RequestTransaction> = {
    run: (work) =>
      f.requestUow.run(async (tx) => {
        if (!tx.pickup) throw new Error("Нет транзакционного порта очереди");
        const pickup = new Proxy(tx.pickup, {
          get(target, key) {
            if (key === "lockTicketDays")
              return async (
                ...args: Parameters<typeof target.lockTicketDays>
              ) => {
                entered += 1;
                if (entered === 2) release?.();
                await both;
                return target.lockTicketDays(...args);
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return work({ ...tx, pickup });
      }),
  };
  const book = new BookRequestPickup(concurrent, f.clock, f.ids, f.limiter);
  const nextSlot = "2026-11-10T08:00:00.000Z";
  const results = await Promise.allSettled([
    book.execute(f.anna, {
      id: first,
      windowId: f.windowId,
      slotStartsAt: nextSlot,
    }),
    book.execute(f.second, {
      id: second,
      windowId: f.windowId,
      slotStartsAt: nextSlot,
    }),
  ]);
  expect(entered).toBe(2);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failed = results.find((result) => result.status === "rejected");
  expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(
    ConflictError,
  );
  const winner = results.findIndex((result) => result.status === "fulfilled");
  for (const [index, ticket] of previous.entries())
    expect(
      await f.sql`select status from pickup_bookings where id = ${ticket.id}`,
    ).toEqual([
      {
        status:
          index === winner ? "no_show" : index === 0 ? "booked" : "called",
      },
    ]);
  expect(
    await f.sql`select id from pickup_bookings where window_id = ${f.windowId} and slot_starts_at = ${nextSlot} and status in ('booked', 'called')`,
  ).toHaveLength(1);
  expect(
    await f.sql`select request_id, count(*)::integer as count from pickup_bookings
      where request_id = any(${[first, second]}::uuid[]) and status in ('booked', 'called')
      group by request_id order by request_id`,
  ).toEqual(
    [first, second].sort().map((request_id) => ({ request_id, count: 1 })),
  );
  expect(
    await f.sql`select status from requests where id = any(${[first, second]}::uuid[])`,
  ).toEqual([{ status: "ready" }, { status: "ready" }]);
});

it("два встречных переноса не образуют deadlock и сохраняют исходные талоны при занятых слотах", async () => {
  const first = await f.ready(),
    second = await f.ready(f.second);
  const later = "2026-11-09T08:10:00.000Z";
  const a = await f.book.execute(f.anna, {
    id: first,
    windowId: f.windowId,
    slotStartsAt,
  });
  const b = await f.book.execute(f.second, {
    id: second,
    windowId: f.windowId,
    slotStartsAt: later,
  });
  let entered = 0;
  let release: (() => void) | undefined;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent: UnitOfWork<RequestTransaction> = {
    run: (work) =>
      f.requestUow.run(async (tx) => {
        if (!tx.pickup) throw new Error("Нет транзакционного порта очереди");
        const pickup = new Proxy(tx.pickup, {
          get(target, key) {
            if (key === "lockTicketDays")
              return async (
                ...args: Parameters<typeof target.lockTicketDays>
              ) => {
                entered += 1;
                if (entered === 2) release?.();
                await both;
                return target.lockTicketDays(...args);
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return work({ ...tx, pickup });
      }),
  };
  const book = new BookRequestPickup(concurrent, f.clock, f.ids, f.limiter);
  const results = await Promise.allSettled([
    book.execute(f.anna, {
      id: first,
      windowId: f.windowId,
      slotStartsAt: later,
    }),
    book.execute(f.second, { id: second, windowId: f.windowId, slotStartsAt }),
  ]);
  expect(entered).toBe(2);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.reason).toBeInstanceOf(
      ConflictError,
    );
  }
  expect((await f.getPickup.execute(f.anna, { id: first })).booking?.id).toBe(
    a.id,
  );
  expect(
    (await f.getPickup.execute(f.second, { id: second })).booking?.id,
  ).toBe(b.id);
});

it("IDOR записи: Анна не записывается на готовую заявку Тимура, PostgreSQL не меняется", async () => {
  const id = await f.ready(f.timur);
  const before =
    await f.sql`select * from pickup_bookings where request_id = ${id}`;
  await expect(
    f.book.execute(f.anna, { id, windowId: f.foreignWindowId, slotStartsAt }),
  ).rejects.toThrow(NotFoundError);
  expect(
    await f.sql`select * from pickup_bookings where request_id = ${id}`,
  ).toEqual(before);
  expect(await f.sql`select status from requests where id = ${id}`).toEqual([
    { status: "ready" },
  ]);
});

it("дробные секунды нормализуются до PostgreSQL: тот же слот сохраняет талон и номер", async () => {
  const id = await f.ready();
  const ticket = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt: "2026-11-09T08:00:00.0004Z",
  });
  expect(ticket.slotStartsAt).toBe(slotStartsAt);
  const same = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt: "2026-11-09T08:00:00.0000Z",
  });
  expect(same.id).toBe(ticket.id);
  expect(same.ticketNo).toBe(ticket.ticketNo);
  expect(
    await f.sql`select id from pickup_bookings where request_id = ${id}`,
  ).toEqual([{ id: ticket.id }]);
});

it("единый PostgreSQL-лимит записи и отмены блокирует двадцать первое изменение на 15 минут", async () => {
  const id = await f.ready();
  for (let count = 0; count < 10; count++) {
    const ticket = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt,
    });
    await f.cancel.execute(f.anna, { id: ticket.id });
  }
  const before =
    await f.sql`select id, status, ticket_no from pickup_bookings where request_id = ${id} order by created_at, id`;
  await expect(
    f.book.execute(f.anna, { id, windowId: f.windowId, slotStartsAt }),
  ).rejects.toThrow(RateLimitedError);
  expect(
    await f.sql`select id, status, ticket_no from pickup_bookings where request_id = ${id} order by created_at, id`,
  ).toEqual(before);
  expect(
    await f.sql`select id from login_attempts where key = ${`pickup-change:${f.anna.userId}`}`,
  ).toHaveLength(20);
  f.clock.set("2026-11-09T06:15:00.000Z");
  const ticket = await f.book.execute(f.anna, {
    id,
    windowId: f.windowId,
    slotStartsAt,
  });
  expect(ticket.ticketNo).toBe("Б-011");
});

it("параллельные временные сотрудники изолированы собственными факультетами, а не общим демо-ФМО", async () => {
  const other = await openPickupFixture();
  try {
    other.clock.set(f.clock.now().toISOString());
    expect(other.ownFacultyId).not.toBe(f.ownFacultyId);
    expect(
      await f.sql`select faculty_id from staff_faculties where staff_id = ${f.limited.staffId}`,
    ).toEqual([{ faculty_id: f.ownFacultyId }]);
    const id = await f.ready(),
      foreignId = await other.ready();
    const own = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt,
    });
    const foreign = await other.book.execute(other.anna, {
      id: foreignId,
      windowId: other.windowId,
      slotStartsAt,
    });
    const queue = await f.listPickup.execute(f.limited);
    expect(queue.map((booking) => booking.id)).toEqual([own.id]);
    expect(queue.some((booking) => booking.id === foreign.id)).toBe(false);
    expect(
      await f.pickup.findByIdForFaculties(foreign.id, f.limited.facultyIds),
    ).toBeNull();
    await expect(
      f.changePickup.execute(f.limited, { id: foreign.id, to: "called" }),
    ).rejects.toThrow(NotFoundError);
  } finally {
    await other.close();
  }
});
