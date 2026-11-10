import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "@/application/ports/actor";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import { ChangeRequestStatus } from "@/application/requests/change-request-status";
import {
  BookRequestPickup,
  CancelRequestPickup,
  GetRequestPickup,
  ListMyPickup,
} from "@/application/requests/pickup";
import {
  PICKUP_CHANGE_LIMIT,
  PICKUP_CHANGE_WINDOW_SEC,
  pickupChangeKey,
} from "@/application/requests/pickup-limits";
import type { PickupBookingRecord } from "@/application/requests/pickup-ports";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import { ChangeStaffPickup, ListStaffPickup } from "@/application/staff/pickup";
import type { StaffTransaction } from "@/application/staff/ports";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, FakeRateLimiter, marina, timur } from "../fakes/identity";
import { enrollmentType, FakeRequests } from "../fakes/requests";
import type { FakePickup } from "../fakes/requests-pickup";

const requestId = "00000000-0000-7000-8000-000000000090";
const windowId = "00000000-0000-7000-8000-000000000091";
const foreignWindowId = "00000000-0000-7000-8000-000000000092";
const slot = "2026-11-05T09:00:00.000Z";
const later = "2026-11-05T09:10:00.000Z";
const teacher: Actor = {
  kind: "teacher",
  userId: "teacher-user",
  teacherId: "teacher",
};
const foreignStaff: Actor = {
  kind: "staff",
  userId: "other-user",
  staffId: "other-staff",
  facultyIds: ["other"],
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let requests: FakeRequests;
let pickup: FakePickup;
let clock: FakeClock;
let book: BookRequestPickup;
let cancel: CancelRequestPickup;
let get: GetRequestPickup;
let staff: ChangeStaffPickup;
let uow: UnitOfWork<StaffTransaction>;
let audit: { action: string }[];
let failAudit: boolean;
let limiter: FakeRateLimiter;

beforeEach(() => {
  requests = new FakeRequests();
  requests.types = [{ ...enrollmentType, delivery: "pickup" }];
  requests.records = [
    {
      id: requestId,
      publicNo: "З-2026-000090",
      studentId: "anna-student",
      facultyId: "fmo",
      studentUserId: "anna-user",
      typeCode: "enrollment",
      payload: { destination: "По месту требования" },
      status: "ready",
      assignee: null,
      submittedAt: "2026-11-01T06:00:00.000Z",
      dueAt: null,
      createdAt: "2026-11-01T06:00:00.000Z",
      updatedAt: "2026-11-05T06:00:00.000Z",
    },
  ];
  pickup = requests.pickup;
  clock = new FakeClock("2026-11-05T06:00:00.000Z");
  const ids = new SequentialIdGenerator();
  audit = [];
  failAudit = false;
  uow = {
    async run(work) {
      const saved = structuredClone({ bookings: pickup.bookings, audit });
      try {
        return await requests.run((tx) =>
          work({
            ...tx,
            pickup,
            audit: {
              record: async (entry) => {
                audit.push(entry);
                if (failAudit) throw new Error("Тестовый отказ аудита");
              },
            },
          }),
        );
      } catch (error) {
        pickup.bookings = saved.bookings;
        audit = saved.audit;
        throw error;
      }
    },
  };
  limiter = new FakeRateLimiter(clock);
  book = new BookRequestPickup(uow, clock, ids, limiter);
  cancel = new CancelRequestPickup(uow, clock, limiter);
  get = new GetRequestPickup(requests, pickup, clock);
  staff = new ChangeStaffPickup(uow, clock, ids, logger);
});

async function reserve() {
  return book.execute(anna, { id: requestId, windowId, slotStartsAt: slot });
}

it("студент видит только окна своего факультета, свободные слоты и безопасный DTO талона", async () => {
  const before = await get.execute(anna, { id: requestId });
  expect(before).toMatchObject({
    eligible: true,
    booking: null,
    windows: [{ id: windowId }],
  });
  expect(before.windows).toHaveLength(1);
  expect(before.windows[0]?.slots).toContain(slot);
  const ticket = await reserve();
  expect(ticket).toMatchObject({
    ticketNo: "Б-001",
    windowTitle: "Окно 1",
    canCancel: true,
  });
  const after = await get.execute(anna, { id: requestId });
  expect(after.booking).toEqual(ticket);
  expect(after.windows[0]?.slots).not.toContain(slot);
  expect(JSON.stringify(ticket)).not.toMatch(/userId|studentId|facultyId/);
  expect(await new ListMyPickup(pickup, clock).execute(anna)).toEqual([ticket]);
  expect(await new ListMyPickup(pickup, clock).execute(timur)).toEqual([]);
});

it("перенос отменяет старый талон и оставляет ровно одну активную запись", async () => {
  const first = await reserve();
  expect(await reserve()).toEqual(first);
  const next = await book.execute(anna, {
    id: requestId,
    windowId,
    slotStartsAt: later,
  });
  expect(next.ticketNo).toBe("Б-002");
  expect(pickup.bookings.map((b) => b.status)).toEqual(["cancelled", "booked"]);
  await cancel.execute(anna, { id: next.id });
  expect((await get.execute(anna, { id: requestId })).booking).toBeNull();
  expect(
    (await get.execute(anna, { id: requestId })).windows[0]?.slots,
  ).toContain(later);
});

it("запись и отмена талона обновляют время заявки для часового восстановления демо", async () => {
  clock.advance(10 * 60_000);
  const ticket = await reserve();
  expect(requests.records[0]?.updatedAt).toBe(clock.now().toISOString());
  clock.advance(10 * 60_000);
  await cancel.execute(anna, { id: ticket.id });
  expect(requests.records[0]?.updatedAt).toBe(clock.now().toISOString());
});

it("перенос блокирует старый и новый день до блокировки талона и освобождения слота", async () => {
  const original = await reserve();
  const activeReads = vi.spyOn(pickup, "findActiveForRequestForStudent");
  const dailyLocks = vi
    .spyOn(pickup, "lockTicketDays")
    .mockImplementation(async (keys) => {
      expect(
        pickup.bookings.find((booking) => booking.id === original.id)?.status,
      ).toBe("booked");
      expect(keys).toEqual([
        { windowId, day: "2026-11-06" },
        { windowId, day: "2026-11-05" },
      ]);
    });
  const cancellation = vi.spyOn(pickup, "setStatus");
  await book.execute(anna, {
    id: requestId,
    windowId,
    slotStartsAt: "2026-11-06T09:00:00.000Z",
  });
  expect(activeReads.mock.calls).toEqual([
    [requestId, "anna-student"],
    [requestId, "anna-student", true],
  ]);
  expect(dailyLocks.mock.invocationCallOrder[0]).toBeGreaterThan(
    activeReads.mock.invocationCallOrder[0] ?? 0,
  );
  expect(dailyLocks.mock.invocationCallOrder[0]).toBeLessThan(
    activeReads.mock.invocationCallOrder[1] ?? 0,
  );
  expect(cancellation.mock.invocationCallOrder[0]).toBeGreaterThan(
    dailyLocks.mock.invocationCallOrder[0] ?? 0,
  );
});

it("неудачный перенос сохраняет исходный талон", async () => {
  const ticket = await reserve();
  pickup.bookings.push({
    ...(pickup.bookings[0] as PickupBookingRecord),
    id: "00000000-0000-7000-8000-000000000099",
    requestId: "other",
    slotStartsAt: later,
  });
  await expect(
    book.execute(anna, { id: requestId, windowId, slotStartsAt: later }),
  ).rejects.toThrow(ConflictError);
  expect(pickup.bookings.find((b) => b.id === ticket.id)?.status).toBe(
    "booked",
  );
  expect((await get.execute(anna, { id: requestId })).booking?.id).toBe(
    ticket.id,
  );
});

it("вызванный заранее талон можно отменить до начала, после начала нельзя отменить или перенести", async () => {
  const ticket = await reserve();
  await staff.execute(marina, { id: ticket.id, to: "called" });
  expect((await get.execute(anna, { id: requestId })).booking?.canCancel).toBe(
    true,
  );
  clock.set(slot);
  await expect(cancel.execute(anna, { id: ticket.id })).rejects.toThrow(
    ConflictError,
  );
  await expect(
    book.execute(anna, { id: requestId, windowId, slotStartsAt: later }),
  ).rejects.toThrow(ConflictError);
});

it.each([
  "draft",
  "submitted",
  "accepted",
  "in_progress",
  "needs_info",
  "issued",
  "cancelled",
  "rejected",
] as const)("для статуса %s нет записи", async (status) => {
  const record = requests.records[0];
  if (!record) throw new Error("Нет заявки");
  record.status = status;
  expect(await get.execute(anna, { id: requestId })).toEqual({
    eligible: false,
    booking: null,
    windows: [],
  });
  await expect(reserve()).rejects.toThrow(ValidationError);
});

it.each([
  { delivery: "pdf" as const, isCertificate: true },
  { delivery: "pickup" as const, isCertificate: false },
])(
  "электронный документ и обычное обращение не записываются в очередь",
  async (properties) => {
    requests.types = [{ ...enrollmentType, ...properties }];
    expect((await get.execute(anna, { id: requestId })).eligible).toBe(false);
    await expect(reserve()).rejects.toThrow(ValidationError);
  },
);

it("чужая заявка, чужой талон и чужое окно неотличимы от отсутствующих", async () => {
  const ticket = await reserve();
  await expect(get.execute(timur, { id: requestId })).rejects.toThrow(
    NotFoundError,
  );
  await expect(
    book.execute(timur, { id: requestId, windowId, slotStartsAt: later }),
  ).rejects.toThrow(NotFoundError);
  await expect(cancel.execute(timur, { id: ticket.id })).rejects.toThrow(
    NotFoundError,
  );
  await expect(
    book.execute(anna, {
      id: requestId,
      windowId: foreignWindowId,
      slotStartsAt: later,
    }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    staff.execute(foreignStaff, { id: ticket.id, to: "called" }),
  ).rejects.toThrow(NotFoundError);
  expect(
    await new ListStaffPickup(pickup, clock).execute(foreignStaff),
  ).toEqual([]);
});

it("каждый use case самостоятельно проверяет роль, клиентские userId/studentId отклоняются", async () => {
  const ticket = await reserve();
  for (const actor of [marina, teacher])
    for (const operation of [
      () => get.execute(actor, { id: requestId }),
      () => reserveAs(actor),
      () => cancel.execute(actor, { id: ticket.id }),
      () => new ListMyPickup(pickup, clock).execute(actor),
    ])
      await expect(operation()).rejects.toThrow(ForbiddenError);
  for (const actor of [anna, teacher]) {
    await expect(
      staff.execute(actor, { id: ticket.id, to: "called" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      new ListStaffPickup(pickup, clock).execute(actor),
    ).rejects.toThrow(ForbiddenError);
  }
  for (const extra of [{ userId: "other" }, { studentId: "other" }]) {
    await expect(
      book.execute(anna, {
        id: requestId,
        windowId,
        slotStartsAt: later,
        ...extra,
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      cancel.execute(anna, { id: ticket.id, ...extra }),
    ).rejects.toThrow(ValidationError);
    await expect(
      staff.execute(marina, { id: ticket.id, to: "called", ...extra }),
    ).rejects.toThrow(ValidationError);
  }
});
function reserveAs(actor: Actor) {
  return book.execute(actor, { id: requestId, windowId, slotStartsAt: slot });
}

it("вызов пишет уведомление для pulse и аудит, выдача закрывает талон через request-flow", async () => {
  const ticket = await reserve();
  await staff.execute(marina, { id: ticket.id, to: "called" });
  expect(requests.notifications[0]?.title).toBe("Вас вызывают в окно 1");
  expect(requests.records[0]?.status).toBe("ready");
  expect((await get.execute(anna, { id: requestId })).booking?.status).toBe(
    "called",
  );
  await expect(
    staff.execute(marina, { id: ticket.id, to: "called" }),
  ).rejects.toThrow(ConflictError);
  await staff.execute(marina, { id: ticket.id, to: "served" });
  expect(requests.records[0]?.status).toBe("issued");
  expect(pickup.bookings[0]?.status).toBe("served");
  expect(requests.events).toMatchObject([
    { fromStatus: "ready", toStatus: "issued", actorUserId: marina.userId },
  ]);
  expect(requests.notifications).toHaveLength(2);
  expect(audit.map((a) => a.action)).toEqual([
    "pickup_called",
    "request.issue",
  ]);
});

it("сбой аудита откатывает выдачу, запись очереди, событие и уведомление", async () => {
  const ticket = await reserve();
  failAudit = true;
  await expect(
    staff.execute(marina, { id: ticket.id, to: "served" }),
  ).rejects.toThrow("Тестовый отказ аудита");
  expect(requests.records[0]?.status).toBe("ready");
  expect(pickup.bookings[0]?.status).toBe("booked");
  expect(requests.events).toEqual([]);
  expect(requests.notifications).toEqual([]);
  expect(audit).toEqual([]);
});

it("обычная смена статуса на issued также завершает активный талон", async () => {
  await reserve();
  await new ChangeRequestStatus(
    uow,
    clock,
    new SequentialIdGenerator(),
  ).execute(marina, { id: requestId, to: "issued" });
  expect(pickup.bookings[0]?.status).toBe("served");
});

it("неявка освобождает слот и позволяет записаться заново", async () => {
  const ticket = await reserve();
  clock.set(slot);
  await staff.execute(marina, { id: ticket.id, to: "no_show" });
  expect(requests.records[0]?.status).toBe("ready");
  const next = await book.execute(anna, {
    id: requestId,
    windowId,
    slotStartsAt: later,
  });
  expect(next.ticketNo).toBe("Б-002");
  expect(pickup.bookings.map((b) => b.status)).toEqual(["no_show", "booked"]);
});

it.each(["booked", "called"] as const)(
  "вчерашний талон %s без отметки сотрудника не блокирует новую запись",
  async (status) => {
    const previous = await reserve();
    if (status === "called")
      await staff.execute(marina, { id: previous.id, to: "called" });
    clock.set("2026-11-06T06:00:00.000Z");
    const next = await book.execute(anna, {
      id: requestId,
      windowId,
      slotStartsAt: "2026-11-06T09:00:00.000Z",
    });
    expect(next.id).not.toBe(previous.id);
    expect(pickup.bookings.map((booking) => booking.status)).toEqual([
      "no_show",
      "booked",
    ]);
    expect(requests.records[0]?.status).toBe("ready");
  },
);

it.each(["booked", "called"] as const)(
  "чтение талона %s после полуночи возвращает no_show без записи в БД",
  async (status) => {
    const ticket = await reserve();
    if (status === "called")
      await staff.execute(marina, { id: ticket.id, to: "called" });
    clock.set("2026-11-05T20:59:00.000Z");
    expect((await get.execute(anna, { id: requestId })).booking).toMatchObject({
      status,
      canCancel: false,
    });
    clock.set("2026-11-05T21:00:00.000Z");
    const expected = { ...ticket, status: "no_show", canCancel: false };
    expect((await get.execute(anna, { id: requestId })).booking).toEqual(
      expected,
    );
    expect(await new ListMyPickup(pickup, clock).execute(anna)).toEqual([
      expected,
    ]);
    expect(pickup.bookings[0]?.status).toBe(status);
    await expect(cancel.execute(anna, { id: ticket.id })).rejects.toThrow(
      ConflictError,
    );
    await expect(
      staff.execute(marina, { id: ticket.id, to: "served" }),
    ).rejects.toThrow(ConflictError);
    expect(requests.records[0]?.status).toBe("ready");
  },
);

it("дробные секунды нормализуются до БД, тот же слот сохраняет исходный талон", async () => {
  const insert = vi.spyOn(pickup, "insert");
  const fractional = slot.replace(".000Z", ".0004Z");
  const first = await book.execute(anna, {
    id: requestId,
    windowId,
    slotStartsAt: fractional,
  });
  expect(first.slotStartsAt).toBe(slot);
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({ slotStartsAt: slot }),
  );
  const repeated = await book.execute(anna, {
    id: requestId,
    windowId,
    slotStartsAt: slot.replace(".000Z", "Z"),
  });
  expect(repeated).toEqual(first);
  const repeatedFraction = await book.execute(anna, {
    id: requestId,
    windowId,
    slotStartsAt: fractional,
  });
  expect(repeatedFraction).toEqual(first);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(pickup.bookings).toHaveLength(1);
});

it("дробный момент за пределами сетки отклоняется в application до записи в БД", async () => {
  const insert = vi.spyOn(pickup, "insert");
  await expect(
    book.execute(anna, {
      id: requestId,
      windowId,
      slotStartsAt: slot.replace(".000Z", ".0014Z"),
    }),
  ).rejects.toThrow(ValidationError);
  expect(insert).not.toHaveBeenCalled();
  expect(pickup.bookings).toEqual([]);
});

it("общий лимит записи и отмены: 21-е действие за 15 минут отклоняется до мутации", async () => {
  const reserveCall = vi.spyOn(limiter, "reserve");
  for (let index = 0; index < PICKUP_CHANGE_LIMIT / 2; index++) {
    const booking = await reserve();
    await cancel.execute(anna, { id: booking.id });
  }
  const snapshot = structuredClone(pickup.bookings);
  await expect(reserve()).rejects.toThrow(RateLimitedError);
  await expect(reserve()).rejects.toThrow("Подождите 15 минут");
  expect(pickup.bookings).toEqual(snapshot);
  expect(reserveCall).toHaveBeenLastCalledWith([
    {
      key: pickupChangeKey(anna.userId),
      limit: PICKUP_CHANGE_LIMIT,
      windowSec: PICKUP_CHANGE_WINDOW_SEC,
    },
  ]);
  expect(limiter.attempts.get(pickupChangeKey(anna.userId))).toHaveLength(
    PICKUP_CHANGE_LIMIT,
  );
  clock.set(
    new Date(
      clock.now().getTime() + PICKUP_CHANGE_WINDOW_SEC * 1000,
    ).toISOString(),
  );
  await expect(reserve()).resolves.toMatchObject({ ticketNo: "Б-011" });
});

it("повторы того же талона также занимают квоту и не меняют номер", async () => {
  const ticket = await reserve();
  for (let index = 1; index < PICKUP_CHANGE_LIMIT; index++)
    expect(await reserve()).toEqual(ticket);
  await expect(cancel.execute(anna, { id: ticket.id })).rejects.toThrow(
    RateLimitedError,
  );
  expect(pickup.bookings).toHaveLength(1);
  expect(pickup.bookings[0]?.status).toBe("booked");
  await expect(
    book.execute(timur, { id: requestId, windowId, slotStartsAt: later }),
  ).rejects.toThrow(NotFoundError);
});

it.each(["called", "no_show"] as const)(
  "действие %s не меняет талон неготовой заявки",
  async (to) => {
    const ticket = await reserve();
    const record = requests.records[0];
    if (!record) throw new Error("Нет заявки");
    record.status = "in_progress";
    clock.set(slot);
    await expect(staff.execute(marina, { id: ticket.id, to })).rejects.toThrow(
      ConflictError,
    );
    expect(pickup.bookings[0]?.status).toBe("booked");
    expect(requests.notifications).toEqual([]);
    expect(audit).toEqual([]);
  },
);

it("issued без адаптера очереди завершается ошибкой до сохранения статуса", async () => {
  await reserve();
  const save = vi.spyOn(requests, "save");
  const missing: UnitOfWork<StaffTransaction> = {
    run: (work) => uow.run((tx) => work({ ...tx, pickup: undefined })),
  };
  await expect(
    new ChangeRequestStatus(
      missing,
      clock,
      new SequentialIdGenerator(),
    ).execute(marina, { id: requestId, to: "issued" }),
  ).rejects.toThrow(ValidationError);
  expect(save).not.toHaveBeenCalled();
  expect(requests.records[0]?.status).toBe("ready");
  expect(pickup.bookings[0]?.status).toBe("booked");
  expect(requests.events).toEqual([]);
  expect(requests.notifications).toEqual([]);
});
