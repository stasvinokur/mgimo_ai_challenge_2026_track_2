import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DispatchPush } from "@/application/notifications/push";
import type { Actor } from "@/application/ports/actor";
import type {
  PushPayload,
  PushResult,
  PushSender,
  PushSubscription,
} from "@/application/ports/push-sender";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import {
  PUSH_GENERIC_BODY,
  PUSH_REQUEST_BODY,
} from "@/domain/notifications/push-policy";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { PostgresPushRepository } from "@/infrastructure/db/repositories/notifications/push";
import { DrizzleStaffUnitOfWork } from "@/infrastructure/db/repositories/requests/staff-unit-of-work";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";

class Sender implements PushSender {
  readonly enabled = true;
  calls: { subscription: PushSubscription; payload: PushPayload }[] = [];
  result: PushResult = { status: "sent" };
  beforeSend?: (
    subscription: PushSubscription,
    payload: PushPayload,
  ) => Promise<void>;

  async send(subscription: PushSubscription, payload: PushPayload) {
    this.calls.push({ subscription, payload });
    await this.beforeSend?.(subscription, payload);
    return this.result;
  }
}

describe.skipIf(!process.env.DATABASE_URL)("Web Push PostgreSQL", () => {
  const ids = new UuidV7Generator();
  const clock = new FakeClock("2030-11-05T12:00:00.000Z");
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fixtures: StudentTestData[] = [];
  let sql: ReturnType<typeof createDatabase>;
  let anna: StudentTestData["actor"];
  let timur: StudentTestData["actor"];
  let marina: Extract<Actor, { kind: "staff" }>;
  let repository: PostgresPushRepository;
  let sender: Sender;
  let dispatch: DispatchPush;

  function subscription(): PushSubscription {
    return {
      endpoint: `https://fcm.googleapis.com/fcm/send/${ids.next()}`,
      keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
    };
  }

  async function addNotification(userId = anna.userId, age = 0) {
    const id = ids.next();
    await sql`insert into notifications (id, user_id, kind, title, body, link, created_at)
      values (${id}, ${userId}, 'request', 'Вымышленное ФИО — 98 баллов',
        'Комментарий содержит лишние данные', ${`/requests/${id}`},
        ${new Date(clock.now().getTime() - age).toISOString()}::timestamptz)`;
    return id;
  }

  async function pushedAt(id: string) {
    const [row] = await sql<{ pushedAt: Date | null }[]>`
      select pushed_at as "pushedAt" from notifications where id = ${id}`;
    return row?.pushedAt?.toISOString() ?? null;
  }

  beforeAll(async () => {
    sql = createDatabase(4);
    const own = await openStudentTestData("anna");
    fixtures.push(own);
    anna = own.actor;
    const foreign = await openStudentTestData("timur");
    fixtures.push(foreign);
    timur = foreign.actor;
    repository = new PostgresPushRepository(() => sql, ids);
    const identity = new PostgresIdentityRepository(() => sql);
    const credentials = await identity.findCredentials("marina");
    const actor =
      credentials && (await identity.findActorByUserId(credentials.userId));
    if (actor?.kind !== "staff") throw new Error("Нужен демо-сид сотрудника.");
    marina = actor;
  });

  beforeEach(async () => {
    await sql`delete from push_subscriptions where user_id in (${anna.userId}, ${timur.userId})`;
    await sql`delete from notifications where user_id in (${anna.userId}, ${timur.userId})`;
    sender = new Sender();
    dispatch = new DispatchPush(repository, () => sender, clock, logger);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    try {
      await Promise.all(fixtures.map((fixture) => fixture.close()));
    } finally {
      await sql?.end({ timeout: 1 });
    }
  });

  it("повторный endpoint обновляет только свою запись; чужая подписка не перехватывается и не удаляется", async () => {
    const own = subscription();
    expect(await repository.saveForUser(anna.userId, own)).toBe(true);
    const before = await repository.listForUser(anna.userId);
    const updated = { ...own, keys: { ...own.keys, auth: "b".repeat(22) } };
    expect(await repository.saveForUser(anna.userId, updated)).toBe(true);
    expect(await repository.saveForUser(timur.userId, own)).toBe(false);
    expect(await repository.deleteForUser(timur.userId, own.endpoint)).toBe(
      false,
    );
    const after = await repository.listForUser(anna.userId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual({ id: before[0]?.id, ...updated });
    expect(await repository.listForUser(timur.userId)).toEqual([]);
    expect(await repository.deleteForUser(anna.userId, own.endpoint)).toBe(
      true,
    );
    expect(await repository.listForUser(anna.userId)).toEqual([]);
  });

  it("отправляет только свежие свои уведомления, отмечает pushed_at и не дублирует повторный запуск", async () => {
    const own = subscription();
    const foreign = subscription();
    await repository.saveForUser(anna.userId, own);
    await repository.saveForUser(timur.userId, foreign);
    const fresh = await addNotification();
    const boundary = await addNotification(anna.userId, 300_000);
    const old = await addNotification(anna.userId, 300_001);
    const other = await addNotification(timur.userId);
    await dispatch.execute(anna);
    await dispatch.execute(anna);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls.map((call) => call.subscription.endpoint)).toEqual([
      own.endpoint,
    ]);
    expect(sender.calls.map((call) => call.payload)).toEqual([
      {
        title: "Пульс",
        body: PUSH_GENERIC_BODY,
        link: "/notifications",
      },
    ]);
    expect(await pushedAt(fresh)).toBe(clock.now().toISOString());
    expect(await pushedAt(boundary)).toBe(clock.now().toISOString());
    expect(await pushedAt(old)).toBeNull();
    expect(await pushedAt(other)).toBeNull();
  });

  it("конкурентные диспетчеры не отправляют одну строку дважды", async () => {
    await repository.saveForUser(anna.userId, subscription());
    const notification = await addNotification();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    sender.beforeSend = async () => {
      entered.resolve();
      await release.promise;
    };
    const first = dispatch.execute(anna);
    try {
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error("Отправка не началась.");
        }),
      ]);
      await dispatch.execute(anna);
      expect(sender.calls).toHaveLength(1);
    } finally {
      release.resolve();
      await first;
    }
    await dispatch.execute(anna);
    expect(sender.calls).toHaveLength(1);
    expect(await pushedAt(notification)).toBe(clock.now().toISOString());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("захват очереди уже закоммичен, сеть не держит транзакцию и блокировки строк", async () => {
    const own = subscription();
    await repository.saveForUser(anna.userId, own);
    const notification = await addNotification();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const observer = createDatabase(1);
    sender.beforeSend = async () => {
      entered.resolve();
      await release.promise;
    };
    const first = dispatch.execute(anna);
    try {
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error("Отправка не началась.");
        }),
      ]);
      const [committed] = await observer<{ pushedAt: Date | null }[]>`
        select pushed_at as "pushedAt" from notifications where id = ${notification}`;
      expect(committed?.pushedAt?.toISOString()).toBe(
        clock.now().toISOString(),
      );
      await observer.begin(async (tx) => {
        expect(
          await tx`select id from notifications where id = ${notification} for update nowait`,
        ).toHaveLength(1);
        expect(
          await tx`select id from push_subscriptions where user_id = ${anna.userId} for update nowait`,
        ).toHaveLength(1);
        expect(
          await tx`select id from users where id = ${anna.userId} for update nowait`,
        ).toHaveLength(1);
      });
      expect(sender.calls).toHaveLength(1);
    } finally {
      release.resolve();
      await first;
      await observer.end({ timeout: 1 });
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("одновременный захват разделяет строки без повторов и помечает всю пачку", async () => {
    await repository.saveForUser(anna.userId, subscription());
    const notifications = await Promise.all(
      Array.from({ length: 6 }, () => addNotification()),
    );
    const since = new Date(clock.now().getTime() - 300_000).toISOString();
    const claims = await Promise.all([
      repository.claimForUser(anna.userId, since, clock.now().toISOString()),
      repository.claimForUser(anna.userId, since, clock.now().toISOString()),
    ]);
    const claimed = claims.flat().map((item) => item.id);
    expect(claimed.sort()).toEqual(notifications.sort());
    expect(new Set(claimed).size).toBe(notifications.length);
    for (const id of notifications)
      expect(await pushedAt(id)).toBe(clock.now().toISOString());
  });

  it("несколько уведомлений дают ровно одну отправку каждой подписке", async () => {
    const items = Array.from({ length: 5 }, subscription);
    for (const item of items) await repository.saveForUser(anna.userId, item);
    for (let index = 0; index < 7; index++) await addNotification();
    await dispatch.execute(anna);
    await dispatch.execute(anna);
    expect(sender.calls).toHaveLength(items.length);
    expect(
      sender.calls.map((call) => call.subscription.endpoint).sort(),
    ).toEqual(items.map((item) => item.endpoint).sort());
    expect(
      sender.calls.every(
        (call) =>
          call.payload.body === PUSH_GENERIC_BODY &&
          call.payload.link === "/notifications",
      ),
    ).toBe(true);
  });

  it("шестая подписка атомарно удаляет самую старую только у своего пользователя", async () => {
    const oldest = subscription();
    const foreign = subscription();
    await repository.saveForUser(anna.userId, oldest);
    await repository.saveForUser(timur.userId, foreign);
    await sql`update push_subscriptions set created_at = '2001-01-01T00:00:00Z' where endpoint = ${oldest.endpoint}`;
    for (let index = 0; index < 5; index++)
      await repository.saveForUser(anna.userId, subscription());
    const rows = await sql<
      { endpoint: string }[]
    >`select endpoint from push_subscriptions where user_id = ${anna.userId}`;
    expect(rows).toHaveLength(5);
    expect(rows.some((row) => row.endpoint === oldest.endpoint)).toBe(false);
    expect(
      (await repository.listForUser(timur.userId)).map((item) => item.endpoint),
    ).toEqual([foreign.endpoint]);
  });

  it("конкурентные подписки не обходят предел пяти записей", async () => {
    const items = Array.from({ length: 9 }, subscription);
    const results = await Promise.all(
      items.map((item) => repository.saveForUser(anna.userId, item)),
    );
    expect(results.every(Boolean)).toBe(true);
    const rows = await sql<
      { endpoint: string }[]
    >`select endpoint from push_subscriptions where user_id = ${anna.userId}`;
    expect(rows).toHaveLength(5);
    expect(
      rows.every((row) => items.some((item) => item.endpoint === row.endpoint)),
    ).toBe(true);
  });

  it("failures растёт при неудаче, успех сбрасывает счётчик, третья неудача удаляет подписку", async () => {
    const own = subscription();
    await repository.saveForUser(anna.userId, own);
    const [stored] = await repository.listForUser(anna.userId);
    if (!stored) throw new Error("Нужна тестовая подписка.");
    async function failures() {
      const [row] = await sql<
        { failures: number }[]
      >`select failures from push_subscriptions where endpoint = ${own.endpoint}`;
      return row?.failures ?? null;
    }
    await repository.recordResultForUser(anna.userId, stored, "failed");
    expect(await failures()).toBe(1);
    await repository.recordResultForUser(timur.userId, stored, "gone");
    expect(await failures()).toBe(1);
    await repository.recordResultForUser(anna.userId, stored, "failed");
    expect(await failures()).toBe(2);
    await repository.recordResultForUser(anna.userId, stored, "sent");
    expect(await failures()).toBe(0);
    await repository.recordResultForUser(anna.userId, stored, "disabled");
    expect(await failures()).toBe(0);
    for (let attempt = 0; attempt < 3; attempt++)
      await repository.recordResultForUser(anna.userId, stored, "failed");
    expect(await failures()).toBeNull();
  });

  it("запоздавший ответ старой подписки не меняет обновлённые ключи и чужую запись", async () => {
    const own = subscription();
    await repository.saveForUser(anna.userId, own);
    const [stored] = await repository.listForUser(anna.userId);
    if (!stored) throw new Error("Нужна тестовая подписка.");
    const updated = { ...own, keys: { ...own.keys, auth: "b".repeat(22) } };
    await repository.saveForUser(anna.userId, updated);
    await repository.recordResultForUser(anna.userId, stored, "gone");
    await repository.recordResultForUser(anna.userId, stored, "failed");
    const [current] = await repository.listForUser(anna.userId);
    expect(current?.keys).toEqual(updated.keys);
    const [row] = await sql<
      { failures: number }[]
    >`select failures from push_subscriptions where id = ${stored.id}`;
    expect(row?.failures).toBe(0);
  });

  it("новое уведомление во время отправки предыдущего не теряется из-за занятого диспетчера", async () => {
    await repository.saveForUser(anna.userId, subscription());
    const firstId = await addNotification();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    sender.beforeSend = async (_subscription, payload) => {
      if (payload.link !== `/requests/${firstId}`) return;
      entered.resolve();
      await release.promise;
    };
    const first = dispatch.execute(anna);
    let secondId: string | undefined;
    try {
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error("Отправка не началась.");
        }),
      ]);
      secondId = await addNotification();
      await dispatch.execute(anna);
      expect(sender.calls.map((call) => call.payload.link)).toEqual([
        `/requests/${firstId}`,
        `/requests/${secondId}`,
      ]);
      expect(await pushedAt(secondId)).toBe(clock.now().toISOString());
    } finally {
      release.resolve();
      await first;
    }
    await dispatch.execute(anna);
    expect(sender.calls).toHaveLength(2);
    expect(await pushedAt(firstId)).toBe(clock.now().toISOString());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(["gone", "failed"] as const)(
    "результат %s завершает попытку без дублей; gone удаляет подписку",
    async (status) => {
      const own = subscription();
      await repository.saveForUser(anna.userId, own);
      const notification = await addNotification();
      sender.result = { status };
      await dispatch.execute(anna);
      await dispatch.execute(anna);
      expect(sender.calls).toHaveLength(1);
      expect(await pushedAt(notification)).toBe(clock.now().toISOString());
      expect(await repository.listForUser(anna.userId)).toHaveLength(
        status === "gone" ? 0 : 1,
      );
      if (status === "failed") {
        expect(logger.warn).toHaveBeenCalledWith("push_send_failed");
        const [row] = await sql<
          { failures: number }[]
        >`select failures from push_subscriptions where endpoint = ${own.endpoint}`;
        expect(row?.failures).toBe(1);
      }
    },
  );

  it("поиск владельца заявки сотрудником ограничен факультетом", async () => {
    const [request] = await sql<{ id: string }[]>`select id from requests
      where student_id = ${anna.studentId} limit 1`;
    if (!request) throw new Error("Нужна скопированная заявка.");
    expect(
      await repository.findUserForStaffRequest(request.id, [anna.facultyId]),
    ).toBe(anna.userId);
    expect(
      await repository.findUserForStaffRequest(request.id, [timur.facultyId]),
    ).toBeNull();
    expect(await repository.findUserForStaffRequest(request.id, [])).toBeNull();
    expect(
      await repository.findUserForStaffRequest(ids.next(), [anna.facultyId]),
    ).toBeNull();
  });

  it("push начинается после commit реальной смены статуса; сбой отправки не отменяет готовность", async () => {
    const [request] = await sql<{ id: string }[]>`select id from requests
      where student_id = ${anna.studentId} and status = 'in_progress' limit 1`;
    if (!request) throw new Error("Нужна скопированная заявка в работе.");
    await repository.saveForUser(anna.userId, subscription());
    const change = new ChangeStaffRequestStatus(
      new DrizzleStaffUnitOfWork(() => sql, ids),
      clock,
      ids,
      logger,
    );
    const result = await change.execute(marina, {
      id: request.id,
      to: "ready",
    });
    expect(sender.calls).toEqual([]);
    let observedCommit = false;
    sender.result = { status: "failed" };
    sender.beforeSend = async () => {
      const [committed] = await sql<
        { status: string; pushedAt: Date | null }[]
      >`
        select r.status, n.pushed_at as "pushedAt" from requests r join notifications n
          on n.link = ${`/requests/${request.id}`} and n.user_id = ${anna.userId}
        where r.id = ${request.id}`;
      observedCommit =
        committed?.status === "ready" &&
        committed.pushedAt?.toISOString() === clock.now().toISOString();
    };
    await dispatch.executeForRequest(marina, result.id);
    await dispatch.executeForRequest(marina, result.id);
    expect(observedCommit).toBe(true);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.payload).toEqual({
      title: "Пульс",
      body: PUSH_REQUEST_BODY,
      link: `/requests/${request.id}`,
    });
    const [after] = await sql<
      { status: string }[]
    >`select status from requests where id = ${request.id}`;
    expect(after?.status).toBe("ready");
    expect(logger.warn).toHaveBeenCalledWith("push_send_failed");
  });
});
