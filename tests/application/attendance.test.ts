import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GetAttendanceConfirmation,
  GetMyAttendance,
  INVALID_CODE,
  MarkAttendance,
} from "@/application/attendance/student";
import {
  CloseTeacherAttendance,
  GetTeacherAttendance,
  IssueAttendanceCode,
} from "@/application/attendance/teacher";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  attendanceKey,
  FakeAttendanceTokens,
  FakeAttendanceUnitOfWork,
} from "../fakes/attendance";
import { FakeClock } from "../fakes/clock";
import { FakeRateLimiter } from "../fakes/identity";
import { anna, staff, timur } from "../fakes/schedule";
import { oleg } from "../fakes/teacher";

const serverInput = (input: unknown) =>
  typeof input === "object" && input !== null
    ? { ...input, ip: "192.0.2.35" }
    : input;

let uow: FakeAttendanceUnitOfWork,
  clock: FakeClock,
  tokens: FakeAttendanceTokens,
  limiter: FakeRateLimiter;
const encoder = { encode: async (url: string) => `svg:${url}` };
const origin = () => "https://pulse.example";
const issue = () =>
  new IssueAttendanceCode(uow, clock, tokens, encoder, limiter, origin);
const mark = () => new MarkAttendance(uow, tokens, clock, limiter);
const preview = () => new GetAttendanceConfirmation(uow, tokens, clock);
const close = () => new CloseTeacherAttendance(uow, clock, limiter, tokens);
const input = async () => ({
  code: (
    await issue().execute(oleg, serverInput({ lesson: attendanceKey }))
  ).path.slice(8),
});
beforeEach(() => {
  uow = new FakeAttendanceUnitOfWork();
  clock = new FakeClock("2026-11-02T06:00:00Z");
  tokens = new FakeAttendanceTokens();
  limiter = new FakeRateLimiter(clock);
});
it("открытие, безопасный GET, отметка, повтор и ровно один балл с ключом занятия", async () => {
  const value = await input();
  const before = structuredClone(uow.records);
  expect(await preview().execute(anna, value)).toMatchObject({
    valid: true,
    alreadyPresent: false,
  });
  expect(uow.records).toEqual(before);
  expect(await mark().execute(anna, serverInput(value))).toEqual({
    result: "marked",
    messageCode: "marked",
    points: 1,
  });
  expect(await mark().execute(anna, serverInput(value))).toEqual({
    result: "already",
    messageCode: "alreadyPresent",
  });
  expect(uow.records.records.size).toBe(1);
  expect([...uow.records.points.values()]).toEqual([1]);
  expect([...uow.records.points.keys()][0]).toBe(
    `anna:qr:${attendanceKey.slotId}:${attendanceKey.occurrenceDate}`,
  );
  expect(await preview().execute(anna, value)).toMatchObject({
    valid: true,
    alreadyPresent: true,
  });
});
it("ротация сохраняет короткое перекрытие, старый код истекает ровно через 30 с", async () => {
  const first = await input();
  clock.advance(20000);
  const next = await issue().execute(
    oleg,
    serverInput({
      lesson: attendanceKey,
      previousCode: first.code,
    }),
  );
  expect(next.path).not.toBe(`/attend/${first.code}`);
  expect(await preview().execute(anna, first)).toMatchObject({ valid: true });
  clock.advance(10000);
  expect(await mark().execute(anna, serverInput(first))).toEqual({
    result: "invalid",
    messageCode: INVALID_CODE,
  });
});
it("чужая группа, неизвестный, просроченный, закрытый и неверный код не различаются", async () => {
  const value = await input();
  expect(await mark().execute(timur, serverInput(value))).toEqual({
    result: "invalid",
    messageCode: INVALID_CODE,
  });
  for (const bad of [
    { code: "x".repeat(22) },
    { code: "incorrect" },
    { ...value, studentId: "anna" },
  ])
    expect(await mark().execute(anna, serverInput(bad))).toEqual({
      result: "invalid",
      messageCode: INVALID_CODE,
    });
  await close().execute(oleg, serverInput(attendanceKey));
  expect(await mark().execute(anna, serverInput(value))).toEqual({
    result: "invalid",
    messageCode: INVALID_CODE,
  });
  expect([...uow.records.points]).toEqual([]);
});
it("закрытие идемпотентно, добавляет absent и не позволяет запоздавшей ротации оживить код", async () => {
  const first = await input();
  await close().execute(oleg, serverInput(attendanceKey));
  const records = structuredClone(uow.records.records);
  await close().execute(oleg, serverInput(attendanceKey));
  expect(uow.records.records).toEqual(records);
  expect([...records.values()][0]?.status).toBe("absent");
  await expect(
    issue().execute(
      oleg,
      serverInput({ lesson: attendanceKey, previousCode: first.code }),
    ),
  ).rejects.toThrow(ConflictError);
});
it("окно проверяется повторно после блокировки: запоздавшая отметка не проходит", async () => {
  const value = await input();
  uow.onLock = async () => {
    clock.set("2026-11-02T07:30:00Z");
  };
  expect(await mark().execute(anna, serverInput(value))).toMatchObject({
    result: "invalid",
  });
  expect(uow.records.records.size).toBe(0);
});
it("отзыв во время ожидания блокировки не оставляет отметку", async () => {
  const value = await input();
  uow.onLock = async () => {
    await uow.codes.revokeForLesson(attendanceKey);
  };
  expect(await mark().execute(anna, serverInput(value))).toMatchObject({
    result: "invalid",
  });
  expect(uow.records.records.size).toBe(0);
});
it("если начисление балла падает, отметка откатывается", async () => {
  const value = await input();
  vi.spyOn(uow.records, "awardActivityForStudent").mockRejectedValue(
    new Error("TEST_FAILURE"),
  );
  await expect(mark().execute(anna, serverInput(value))).rejects.toThrow(
    "TEST_FAILURE",
  );
  expect(uow.records.records.size).toBe(0);
});
it("чужая пара недоступна преподавателю и не выдаёт QR", async () => {
  const foreign = { ...oleg, teacherId: "other" };
  await expect(
    issue().execute(foreign, serverInput({ lesson: attendanceKey })),
  ).rejects.toThrow(NotFoundError);
  await expect(
    new GetTeacherAttendance(uow, clock).execute(foreign, attendanceKey),
  ).rejects.toThrow(NotFoundError);
  expect(uow.codes.codes.size).toBe(0);
});
it.each(["2026-11-02T05:49:59Z", "2026-11-02T07:30:00Z"])(
  "открытие вне окна %s невозможно",
  async (at) => {
    clock.set(at);
    await expect(
      issue().execute(oleg, serverInput({ lesson: attendanceKey })),
    ).rejects.toThrow(ConflictError);
  },
);
it("отмена и замена преподавателя после выдачи отзывают возможность отметки", async () => {
  const value = await input();
  const lessons = uow.teacherSchedule.lessons.get(oleg.teacherId);
  if (!lessons?.[0]) throw new Error("Нет пары.");
  lessons[0].status = "cancelled";
  expect(await mark().execute(anna, serverInput(value))).toMatchObject({
    result: "invalid",
  });
  uow.teacherSchedule.lessons.clear();
  expect(await preview().execute(anna, value)).toMatchObject({ valid: false });
});
it("атомарное резервирование ограничивает и успешные, и неуспешные попытки", async () => {
  for (let i = 0; i < 10; i++)
    await mark().execute(anna, serverInput({ code: "x".repeat(22) }));
  await expect(
    mark().execute(anna, serverInput({ code: "x".repeat(22) })),
  ).rejects.toThrow(RateLimitedError);
  expect([...limiter.attempts.keys()].join()).not.toContain("xxxxxxxx");
});
describe("Роль проверяется до чтения и валидации", () => {
  it.each([anna, timur, staff])(
    "преподавательские операции: $kind",
    async (actor) => {
      await expect(issue().execute(actor, serverInput(null))).rejects.toThrow(
        ForbiddenError,
      );
      await expect(close().execute(actor, serverInput(null))).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        new GetTeacherAttendance(uow, clock).execute(actor, null),
      ).rejects.toThrow(ForbiddenError);
      expect(uow.calls).toBe(0);
    },
  );
  it.each([oleg, staff])("студенческие операции: $kind", async (actor) => {
    await expect(mark().execute(actor, serverInput(null))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(preview().execute(actor, null)).rejects.toThrow(
      ForbiddenError,
    );
    expect(uow.calls).toBe(0);
  });
});
it("личная сводка использует только владельца Actor и отклоняет client studentId", async () => {
  await mark().execute(anna, serverInput(await input()));
  const courses = {
    listForStudent: vi.fn(async () => [
      {
        slotId: attendanceKey.slotId,
        courseId: "course",
        title: "Учебная дисциплина",
      },
    ]),
  };
  const query = new GetMyAttendance(uow.records, courses);
  expect(await query.execute(anna)).toMatchObject({
    activityPoints: 1,
    goal: 20,
    courses: [{ present: 1, total: 1, percent: 100 }],
  });
  expect(await query.execute(timur)).toMatchObject({
    activityPoints: 0,
    courses: [{ present: 0, total: 0, percent: null }],
  });
  expect(courses.listForStudent).toHaveBeenLastCalledWith("timur");
  await expect(query.execute(anna, { studentId: "timur" })).rejects.toThrow(
    ValidationError,
  );
  await expect(query.execute(oleg)).rejects.toThrow(ForbiddenError);
});

it.each(["mark", "issue", "close"] as const)(
  "%s: один IP не блокирует общий аккаунт с другого IP до общего потолка",
  async (action) => {
    const actor = action === "mark" ? anna : oleg;
    const run = (ip: string) =>
      action === "mark"
        ? mark().execute(actor, { code: "x".repeat(22), ip })
        : action === "issue"
          ? issue().execute(actor, { lesson: attendanceKey, ip })
          : close().execute(actor, { ...attendanceKey, ip });
    const limit = action === "issue" ? 20 : 10;
    for (let i = 0; i < limit; i++) await run("192.0.2.1");
    await expect(run("192.0.2.1")).rejects.toThrow(RateLimitedError);
    await expect(run("192.0.2.2")).resolves.toBeDefined();
    for (let i = 1; i < limit; i++) await run("192.0.2.2");
    for (let network = 3; network <= 10; network++)
      for (let i = 0; i < limit; i++) await run(`192.0.2.${network}`);
    await expect(run("192.0.2.11")).rejects.toThrow(RateLimitedError);
  },
);
it("закрытие чужой пары не отзывает коды и не создаёт записей", async () => {
  await input();
  const codes = structuredClone(uow.codes.codes);
  await expect(
    close().execute(
      { ...oleg, teacherId: "other" },
      { ...attendanceKey, ip: "192.0.2.35" },
    ),
  ).rejects.toThrow(NotFoundError);
  expect(uow.codes.codes).toEqual(codes);
  expect(uow.records.records.size).toBe(0);
});
it.each([
  "2026-11-02T05:49:59.999Z",
  "2026-11-02T09:30:00.000Z",
  "2026-11-03T06:00:00.000Z",
])("закрытие вне окна %s не создаёт absent и не отзывает коды", async (at) => {
  await input();
  const codes = structuredClone(uow.codes.codes);
  clock.set(at);
  await expect(
    close().execute(oleg, { ...attendanceKey, ip: "192.0.2.35" }),
  ).rejects.toThrow(ConflictError);
  expect(uow.codes.codes).toEqual(codes);
  expect(uow.records.records.size).toBe(0);
  expect(
    await new GetTeacherAttendance(uow, clock).execute(oleg, attendanceKey),
  ).toMatchObject({ canClose: false });
});
it("если окно истекло при ожидании блокировки, закрытие также запрещено", async () => {
  uow.onLock = async () => {
    clock.set("2026-11-02T09:30:00Z");
  };
  await expect(
    close().execute(oleg, { ...attendanceKey, ip: "192.0.2.35" }),
  ).rejects.toThrow(ConflictError);
  expect(uow.records.records.size).toBe(0);
});

it.each(["mark", "issue", "close"] as const)(
  "%s: ключ лимита хранит хэш IP вместо открытого адреса",
  async (action) => {
    const ip = "192.0.2.35";
    const digest = createHash("sha256").update(ip).digest("hex");
    const hash = vi
      .spyOn(tokens, "hash")
      .mockImplementation((value) =>
        createHash("sha256").update(value).digest("hex"),
      );
    const actor = action === "mark" ? anna : oleg;
    if (action === "mark")
      await mark().execute(actor, { code: "x".repeat(22), ip });
    else if (action === "issue")
      await issue().execute(actor, { lesson: attendanceKey, ip });
    else await close().execute(actor, { ...attendanceKey, ip });
    expect(hash).toHaveBeenCalledWith(ip);
    const keys = [...limiter.attempts.keys()];
    expect(keys).toContain(`attendance:${action}:${actor.userId}:${digest}`);
    expect(keys.join()).not.toContain(ip);
  },
);
