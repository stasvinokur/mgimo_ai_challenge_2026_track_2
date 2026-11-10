import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DispatchPush,
  GetPushConfiguration,
  SubscribeToPush,
  TestPush,
  UnsubscribeFromPush,
} from "@/application/notifications/push";
import { parsePushSubscription } from "@/application/notifications/push/schemas";
import type {
  PendingPushNotification,
  PushQueue,
  PushSubscriptionsRepository,
  StoredPushSubscription,
  TeacherPushRecipient,
} from "@/application/notifications/push-ports";
import { TeacherGradePushAccess } from "@/application/notifications/push-teacher";
import type { Actor } from "@/application/ports/actor";
import type {
  PushResult,
  PushSubscription,
} from "@/application/ports/push-sender";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import type {
  GradebookEntry,
  GradebookReadContext,
  TeacherGradebookUnitOfWork,
} from "@/application/teacher/gradebook-ports";
import type { TeacherLesson } from "@/application/teacher/ports";
import { FakeClock } from "../fakes/clock";
import { anna, FakeRateLimiter, marina, timur } from "../fakes/identity";
import { FakePushSender } from "../fakes/push";
import { FakeTeacherScheduleRepository, oleg } from "../fakes/teacher";

const item: PushSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
};
const teacher: Actor = {
  kind: "teacher",
  teacherId: "teacher",
  userId: "teacher-user",
};
class MemoryPush implements PushQueue, PushSubscriptionsRepository {
  subscriptions = new Map<string, StoredPushSubscription[]>();
  pending = new Map<string, PendingPushNotification[]>();
  since: string | undefined;
  at: string | undefined;
  requestUser: string | null = anna.userId;
  faculties: readonly string[] = [];
  results: {
    userId: string;
    endpoint: string;
    status: PushResult["status"];
  }[] = [];
  async listForUser(userId: string) {
    return this.subscriptions.get(userId) ?? [];
  }
  async saveForUser(userId: string, subscription: PushSubscription) {
    if (
      [...this.subscriptions].some(
        ([owner, rows]) =>
          owner !== userId &&
          rows.some((row) => row.endpoint === subscription.endpoint),
      )
    )
      return false;
    const own = await this.listForUser(userId);
    this.subscriptions.set(userId, [
      ...own.filter((row) => row.endpoint !== subscription.endpoint),
      { id: subscription.endpoint, ...subscription },
    ]);
    return true;
  }
  async deleteForUser(userId: string, endpoint: string) {
    const rows = await this.listForUser(userId);
    this.subscriptions.set(
      userId,
      rows.filter((row) => row.endpoint !== endpoint),
    );
    return rows.some((row) => row.endpoint === endpoint);
  }
  async recordResultForUser(
    userId: string,
    subscription: StoredPushSubscription,
    status: PushResult["status"],
  ) {
    this.results.push({ userId, endpoint: subscription.endpoint, status });
    if (status === "gone")
      await this.deleteForUser(userId, subscription.endpoint);
  }
  async claimForUser(userId: string, since: string, at: string) {
    this.since = since;
    this.at = at;
    const items = this.pending.get(userId) ?? [];
    this.pending.delete(userId);
    return items;
  }
  async findUserForStaffRequest(_id: string, faculties: readonly string[]) {
    this.faculties = faculties;
    return this.requestUser;
  }
}
const clock = new FakeClock("2026-11-05T12:00:00Z");
let repo: MemoryPush;
let sender: FakePushSender;
let limiter: FakeRateLimiter;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  repo = new MemoryPush();
  sender = new FakePushSender();
  limiter = new FakeRateLimiter(clock);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});
function cases() {
  return {
    get: new GetPushConfiguration(repo, () =>
      sender.enabled ? "public-key" : null,
    ),
    subscribe: new SubscribeToPush(repo, () => sender, limiter),
    unsubscribe: new UnsubscribeFromPush(repo, limiter),
    test: new TestPush(repo, () => sender, limiter, logger),
    dispatch: new DispatchPush(repo, () => sender, clock, logger),
  };
}

it.each([marina, teacher])(
  "все student use cases запрещены роли $kind",
  async (actor) => {
    const { get, subscribe, unsubscribe, test, dispatch } = cases();
    for (const run of [
      () => get.execute(actor),
      () => subscribe.execute(actor, item),
      () => unsubscribe.execute(actor, item),
      () => test.execute(actor, item),
      () => dispatch.execute(actor),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(sender.calls).toEqual([]);
  },
);

it("подписка идемпотентна; чужой endpoint нельзя перепривязать или удалить", async () => {
  const { get, subscribe, unsubscribe } = cases();
  await subscribe.execute(anna, { ...item, expirationTime: null });
  await subscribe.execute(anna, item);
  expect(await get.execute(anna)).toEqual({
    publicKey: "public-key",
    endpoints: [item.endpoint],
  });
  expect(await get.execute(timur)).toEqual({
    publicKey: "public-key",
    endpoints: [],
  });
  await expect(subscribe.execute(timur, item)).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(
    unsubscribe.execute(timur, { endpoint: item.endpoint }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(await repo.listForUser(anna.userId)).toHaveLength(1);
  await unsubscribe.execute(anna, { endpoint: item.endpoint });
  expect(await repo.listForUser(anna.userId)).toEqual([]);
});

it("без VAPID нельзя подписаться; существующую подписку можно удалить", async () => {
  await repo.saveForUser(anna.userId, item);
  sender.enabled = false;
  const { get, subscribe, unsubscribe, dispatch } = cases();
  expect((await get.execute(anna)).publicKey).toBeNull();
  await expect(subscribe.execute(anna, item)).rejects.toBeInstanceOf(
    ValidationError,
  );
  await dispatch.execute(anna);
  expect(repo.at).toBeUndefined();
  await unsubscribe.execute(anna, { endpoint: item.endpoint });
});

it.each([
  { ...item, userId: "foreign" },
  { ...item, studentId: "foreign" },
  { ...item, keys: { ...item.keys, auth: "invalid" } },
  ...[
    "https://localhost/push",
    "https://127.0.0.1/push",
    "http://fcm.googleapis.com/send/test",
    "https://fcm.googleapis.com.evil.invalid/push",
    "https://u:p@fcm.googleapis.com/push",
    "https://fcm.googleapis.com:8443/push",
    "https://fcm.googleapis.com/push#x",
  ].map((endpoint) => ({ ...item, endpoint })),
])(
  "валидатор отвергает инъекции владельца и небезопасную подписку %#",
  (input) => {
    expect(() => parsePushSubscription(input)).toThrow(ValidationError);
  },
);

it("лимит считает успехи и ошибки и разделяет пользователей", async () => {
  const { unsubscribe } = cases();
  for (let i = 0; i < 30; i++)
    await expect(
      unsubscribe.execute(anna, { endpoint: item.endpoint }),
    ).rejects.toBeInstanceOf(NotFoundError);
  await expect(
    unsubscribe.execute(anna, { endpoint: item.endpoint }),
  ).rejects.toBeInstanceOf(RateLimitedError);
  await expect(
    unsubscribe.execute(timur, { endpoint: item.endpoint }),
  ).rejects.toBeInstanceOf(NotFoundError);
});

it("проверка отправляет только своей подписке нейтральный payload и ограничена 3/мин", async () => {
  const { test } = cases();
  await repo.saveForUser(anna.userId, item);
  await expect(
    test.execute(timur, { endpoint: item.endpoint }),
  ).rejects.toBeInstanceOf(NotFoundError);
  for (let i = 0; i < 3; i++)
    await test.execute(anna, { endpoint: item.endpoint });
  await expect(
    test.execute(anna, { endpoint: item.endpoint }),
  ).rejects.toBeInstanceOf(RateLimitedError);
  expect(sender.calls).toHaveLength(3);
  expect(sender.calls[0]?.payload).toEqual({
    title: "Пульс",
    body: "Уведомления включены. Это проверка доставки.",
    link: "/notifications",
  });
});

it.each(["gone", "failed", "disabled"] as const)(
  "ошибка проверки %s понятна студенту и не выдаёт детали",
  async (status) => {
    await repo.saveForUser(anna.userId, item);
    sender.result = { status };
    await expect(
      cases().test.execute(anna, { endpoint: item.endpoint }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await repo.listForUser(anna.userId)).toHaveLength(
      status === "gone" ? 0 : 1,
    );
  },
);

it("диспетчер использует actor, безопасные тексты и ссылки, повтор не дублирует", async () => {
  await repo.saveForUser(anna.userId, item);
  repo.pending.set(anna.userId, [
    { id: "one", kind: "request", link: "/requests/one" },
    { id: "two", kind: "alert", link: "//evil.invalid" },
  ]);
  repo.pending.set(timur.userId, [
    { id: "foreign", kind: "request", link: "/requests/foreign" },
  ]);
  const { dispatch } = cases();
  await dispatch.execute(anna);
  await dispatch.execute(anna);
  expect(sender.calls.map((call) => call.payload)).toEqual([
    {
      title: "Пульс",
      body: "В кабинете появилось новое уведомление.",
      link: "/notifications",
    },
  ]);
  expect(repo.since).toBe("2026-11-05T11:55:00.000Z");
  expect(repo.at).toBe("2026-11-05T12:00:00.000Z");
  expect(repo.pending.has(timur.userId)).toBe(true);
});

it.each(["failed", "throws", "gone"])(
  "сбой диспетчера %s поглощён, фиксированный лог, без повторов",
  async (mode) => {
    await repo.saveForUser(anna.userId, item);
    repo.pending.set(anna.userId, [
      { id: "one", kind: "request", link: "/requests/one" },
      { id: "two", kind: "request", link: "/requests/two" },
    ]);
    if (mode === "throws")
      sender.beforeSend = async () => {
        throw new Error("secret details");
      };
    else sender.result = { status: mode === "gone" ? "gone" : "failed" };
    const { dispatch } = cases();
    await expect(dispatch.execute(anna)).resolves.toBeUndefined();
    await dispatch.execute(anna);
    expect(sender.calls).toHaveLength(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      "secret details",
    );
    expect(await repo.listForUser(anna.userId)).toHaveLength(
      mode === "gone" ? 0 : 1,
    );
  },
);

it("staff-диспетчер проверяет роль и факультеты; ошибка очереди не ломает вызов", async () => {
  const { dispatch } = cases();
  await expect(
    dispatch.executeForRequest(anna, "request"),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await dispatch.executeForRequest(marina, "request");
  if (marina.kind !== "staff") throw new Error("Нужен сотрудник");
  expect(repo.faculties).toEqual(marina.facultyIds);
  vi.spyOn(repo, "findUserForStaffRequest").mockRejectedValue(
    new Error("secret database details"),
  );
  await expect(
    dispatch.executeForRequest(marina, "request"),
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith("push_dispatch_failed");
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
    "secret database details",
  );
});

it("за проход отправляет одно сообщение на устройство и держит не больше трёх send одновременно", async () => {
  for (let index = 0; index < 5; index++)
    await repo.saveForUser(anna.userId, {
      ...item,
      endpoint: `${item.endpoint}-${index}`,
    });
  repo.pending.set(
    anna.userId,
    Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      kind: "request",
      link: `/requests/${index}`,
    })),
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let active = 0;
  let maximum = 0;
  sender.beforeSend = async () => {
    active++;
    maximum = Math.max(maximum, active);
    if (active === 3) entered.resolve();
    await release.promise;
    active--;
  };
  const work = cases().dispatch.execute(anna);
  try {
    await entered.promise;
    expect(sender.calls).toHaveLength(3);
    expect(repo.pending.has(anna.userId)).toBe(false);
  } finally {
    release.resolve();
    await work;
  }
  expect(maximum).toBe(3);
  expect(sender.calls).toHaveLength(5);
  expect(
    new Set(sender.calls.map((call) => call.subscription.endpoint)).size,
  ).toBe(5);
  expect(
    sender.calls.every((call) => call.payload.link === "/notifications"),
  ).toBe(true);
  expect(repo.results.every((result) => result.status === "sent")).toBe(true);
});

it("общий дедлайн завершает зависший sender за 5 с без поздних повторных записей", async () => {
  vi.useFakeTimers();
  for (let index = 0; index < 5; index++)
    await repo.saveForUser(anna.userId, {
      ...item,
      endpoint: `${item.endpoint}-${index}`,
    });
  repo.pending.set(anna.userId, [
    { id: "one", kind: "request", link: "/requests/one" },
  ]);
  const release = Promise.withResolvers<void>();
  sender.beforeSend = () => release.promise;
  let settled = false;
  const work = cases()
    .dispatch.execute(anna)
    .then(() => {
      settled = true;
    });
  await vi.advanceTimersByTimeAsync(0);
  expect(sender.calls).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(4999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await work;
  expect(settled).toBe(true);
  expect(repo.results).toHaveLength(5);
  expect(repo.results.every((result) => result.status === "failed")).toBe(true);
  release.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(repo.results).toHaveLength(5);
  expect(sender.calls).toHaveLength(3);
});

it("отказ одного устройства не мешает другому, успешный и неуспешный результаты записываются раздельно", async () => {
  await repo.saveForUser(anna.userId, item);
  await repo.saveForUser(anna.userId, {
    ...item,
    endpoint: `${item.endpoint}-other`,
  });
  repo.pending.set(anna.userId, [
    { id: "one", kind: "request", link: "/requests/one" },
  ]);
  sender.beforeSend = async (subscription) => {
    if (subscription.endpoint === item.endpoint)
      throw new Error("PRIVATE_PUSH_DETAILS");
  };
  await cases().dispatch.execute(anna);
  expect(repo.results.map((result) => result.status).sort()).toEqual([
    "failed",
    "sent",
  ]);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
    "PRIVATE_PUSH_DETAILS",
  );
});

it("одиночное уведомление сохраняет безопасную ссылку, внешняя заменяется лентой", async () => {
  await repo.saveForUser(anna.userId, item);
  const { dispatch } = cases();
  for (const link of ["/requests/one", "https://evil.invalid/"]) {
    repo.pending.set(anna.userId, [{ id: "one", kind: "request", link }]);
    await dispatch.execute(anna);
  }
  expect(sender.calls.map((call) => call.payload.link)).toEqual([
    "/requests/one",
    "/notifications",
  ]);
});

function teacherDelivery() {
  const recipient: TeacherPushRecipient = {
    userId: anna.userId,
    slotId: "lesson",
    occurrenceDate: "2026-11-05",
    entryKey: "entry",
  };
  const lesson: TeacherLesson = {
    id: "lesson:2026-11-05",
    uid: "lesson@pulse",
    date: "2026-11-05",
    startsAt: "2026-11-05T09:00:00Z",
    endsAt: "2026-11-05T10:30:00Z",
    room: "ДЕМО-1",
    teacher: "Учебный преподаватель",
    group: "ДЕМО-1",
    course: "Учебная дисциплина",
    kind: "lecture",
    status: "scheduled",
    changes: [],
    revision: 0,
    updatedAt: "2026-11-05T06:00:00Z",
  };
  const schedule = new FakeTeacherScheduleRepository();
  schedule.lessons.set(oleg.teacherId, [lesson]);
  const state = { active: false, reads: 0, baseTeacher: true };
  const entry: GradebookEntry = {
    assessmentId: "work",
    studentId: "anna-student",
    studentUserId: anna.userId,
    courseId: "course",
    courseTitle: "Не отправлять дисциплину в push",
    workTitle: "Не отправлять работу в push",
    maxScore: 100,
    score: 94,
  };
  const ctx: GradebookReadContext = {
    teacherSchedule: schedule,
    books: {
      listForTeacher: async () => [],
      getForTeacherLesson: async () => ({
        courseId: "course",
        works: [],
        students: [],
      }),
      isBaseTeacherForLesson: async () => state.baseTeacher,
      readEntryForTeacherLesson: async (_key, teacherId, entryKey) =>
        teacherId === oleg.teacherId && entryKey === recipient.entryKey
          ? { ...entry }
          : null,
    },
  };
  const uow: TeacherGradebookUnitOfWork = {
    async read(work) {
      state.reads++;
      state.active = true;
      try {
        return await work(ctx);
      } finally {
        state.active = false;
      }
    },
    async run() {
      throw new Error("Чтение push не должно открывать транзакцию записи.");
    },
  };
  const access = new TeacherGradePushAccess(uow, clock);
  return {
    recipient,
    state,
    schedule,
    entry,
    access,
    dispatch: new DispatchPush(repo, () => sender, clock, logger, access),
  };
}

it("новая оценка даёт одну отправку конкретному студенту после завершения повторной проверки", async () => {
  const f = teacherDelivery();
  await repo.saveForUser(anna.userId, item);
  await repo.saveForUser(timur.userId, {
    ...item,
    endpoint: `${item.endpoint}-foreign`,
  });
  repo.pending.set(anna.userId, [
    { id: "grade", kind: "change", link: "/grades/course" },
  ]);
  repo.pending.set(timur.userId, [
    { id: "foreign", kind: "change", link: "/grades/foreign" },
  ]);
  const readStates: boolean[] = [];
  sender.beforeSend = async () => {
    readStates.push(f.state.active);
  };
  await f.dispatch.executeForTeacherGrade(oleg, f.recipient);
  await f.dispatch.executeForTeacherGrade(oleg, f.recipient);
  expect(sender.calls).toHaveLength(1);
  expect(sender.calls[0]?.payload).toEqual({
    title: "Пульс",
    body: "В кабинете появилось новое уведомление.",
    link: "/grades/course",
  });
  expect(f.state.reads).toBe(2);
  expect(readStates).toEqual([false]);
  expect(repo.results[0]?.status).toBe("sent");
  expect(repo.pending.has(timur.userId)).toBe(true);
});

it.each(["student", "entry", "lesson", "teacher"])(
  "отказ повторной проверки (%s) не захватывает очередь и не отправляет push",
  async (foreign) => {
    const f = teacherDelivery();
    await repo.saveForUser(anna.userId, item);
    repo.pending.set(anna.userId, [
      { id: "grade", kind: "change", link: "/grades/course" },
    ]);
    const recipient = { ...f.recipient };
    if (foreign === "student") recipient.userId = timur.userId;
    if (foreign === "entry") recipient.entryKey = "foreign";
    if (foreign === "lesson") recipient.slotId = "foreign";
    const actor =
      foreign === "teacher" ? { ...oleg, teacherId: "foreign" } : oleg;
    await expect(
      f.dispatch.executeForTeacherGrade(actor, recipient),
    ).resolves.toBeUndefined();
    expect(sender.calls).toEqual([]);
    expect(repo.pending.has(anna.userId)).toBe(true);
    expect(repo.at).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  },
);

it.each([anna, marina])(
  "роль $kind не запускает доставку оценки и не читает ведомость",
  async (actor) => {
    const f = teacherDelivery();
    await expect(
      f.dispatch.executeForTeacherGrade(actor, f.recipient),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.state.reads).toBe(0);
    expect(sender.calls).toEqual([]);
  },
);

it("без адаптера повторной проверки доставка преподавателя запрещена по умолчанию", async () => {
  const f = teacherDelivery();
  await cases().dispatch.executeForTeacherGrade(oleg, f.recipient);
  expect(sender.calls).toEqual([]);
  expect(repo.at).toBeUndefined();
});

it("проверка push соблюдает срок доступа заменяющего преподавателя", async () => {
  const f = teacherDelivery();
  f.state.baseTeacher = false;
  expect(await f.access.canNotifyStudent(oleg.teacherId, f.recipient)).toBe(
    true,
  );
  clock.advance(15 * 86_400_000);
  try {
    expect(await f.access.canNotifyStudent(oleg.teacherId, f.recipient)).toBe(
      false,
    );
  } finally {
    clock.set("2026-11-05T12:00:00Z");
  }
});

it("ошибка отправки оценки завершает попытку и не выходит наружу", async () => {
  const f = teacherDelivery();
  await repo.saveForUser(anna.userId, item);
  repo.pending.set(anna.userId, [
    { id: "grade", kind: "change", link: "/grades/course" },
  ]);
  sender.beforeSend = async () => {
    throw new Error("PRIVATE_SENDER_DETAILS");
  };
  await expect(
    f.dispatch.executeForTeacherGrade(oleg, f.recipient),
  ).resolves.toBeUndefined();
  expect(repo.results).toEqual([
    { userId: anna.userId, endpoint: item.endpoint, status: "failed" },
  ]);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
    "PRIVATE_SENDER_DETAILS",
  );
});

it("вызов в окно и выдача отправляются через прежнюю проверку факультета", async () => {
  await repo.saveForUser(anna.userId, item);
  const { dispatch } = cases();
  for (const id of ["called", "served"]) {
    repo.pending.set(anna.userId, [
      { id, kind: "request", link: "/requests/request" },
    ]);
    await dispatch.executeForRequest(marina, "request");
  }
  expect(sender.calls).toHaveLength(2);
  repo.requestUser = null;
  repo.pending.set(anna.userId, [
    { id: "foreign", kind: "request", link: "/requests/request" },
  ]);
  await dispatch.executeForRequest(marina, "foreign");
  expect(sender.calls).toHaveLength(2);
  expect(repo.pending.has(anna.userId)).toBe(true);
});
