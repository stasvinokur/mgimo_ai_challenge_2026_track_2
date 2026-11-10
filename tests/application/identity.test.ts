import { describe, expect, it, vi } from "vitest";
import { GetCurrentActor } from "@/application/identity/get-current-actor";
import { GetStaffProfile } from "@/application/identity/get-staff-profile";
import { Login } from "@/application/identity/login";
import { Logout } from "@/application/identity/logout";
import { loginDestination, safeNextPath } from "@/application/identity/schemas";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import { GetMyProfile } from "@/application/student/get-my-profile";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import {
  anna,
  FakeIdentityRepository,
  FakePasswords,
  FakeRateLimiter,
  FakeSessionStore,
  FakeStudentRepository,
  FakeTokens,
  marina,
  timur,
} from "../fakes/identity";
import { oleg } from "../fakes/teacher";

function setup() {
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  const users = new FakeIdentityRepository();
  const sessions = new FakeSessionStore();
  const tokens = new FakeTokens();
  const passwords = new FakePasswords();
  const limiter = new FakeRateLimiter(clock);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const login = new Login({
    users,
    sessions,
    tokens,
    passwords,
    clock,
    limiter,
    logger,
    ids: new SequentialIdGenerator(),
    dummyHash: async () => "hash:dummy",
  });
  return {
    clock,
    users,
    sessions,
    passwords,
    limiter,
    logger,
    login,
    current: new GetCurrentActor(sessions, users, tokens, clock),
    logout: new Logout(sessions, tokens, clock, logger),
  };
}
const input = { login: "anna", password: "anna-password", ip: "192.0.2.1" };

it("преподаватель проходит тот же вход по паролю и получает Actor только через сессию", async () => {
  const d = setup();
  d.users.credentials.set("oleg", {
    userId: oleg.userId,
    passwordHash: "hash:oleg-password",
  });
  d.users.actors.push(oleg);
  await expect(
    d.login.execute({ ...input, login: "oleg", password: "wrong" }),
  ).rejects.toThrow(ValidationError);
  const result = await d.login.execute({
    ...input,
    login: " OLEG ",
    password: "oleg-password",
  });
  expect(result.kind).toBe("teacher");
  expect(await d.current.execute(result.token)).toMatchObject({ actor: oleg });
  expect([...d.sessions.records.values()][0]?.tokenHash).toBe(
    `digest:${result.token}`,
  );
  await d.logout.execute(result.token);
  expect(await d.current.execute(result.token)).toBeNull();
});

it("вход создаёт сессию на 7 дней, хранит только хэш, успешные попытки не учитываются", async () => {
  const d = setup();
  const result = await d.login.execute({ ...input, login: " ANNA " });
  expect(result).toMatchObject({
    kind: "student",
    expiresAt: "2026-11-11T09:00:00.000Z",
  });
  expect([...d.sessions.records.values()]).toEqual([
    expect.objectContaining({
      userId: anna.userId,
      tokenHash: `digest:${result.token}`,
    }),
  ]);
  expect(d.limiter.attempts.size).toBe(0);
  expect(d.logger.info).toHaveBeenCalledExactlyOnceWith("login_succeeded", {
    user_id: anna.userId,
  });
  expect(await d.current.execute(result.token)).toMatchObject({
    actor: anna,
    renewed: false,
  });
});

it("несуществующий логин и неверный пароль дают одинаковую ошибку, заглушка всё равно проверяется", async () => {
  const d = setup();
  const errors = [];
  for (const login of ["anna", "missing"]) {
    try {
      await d.login.execute({ ...input, login, password: "wrong" });
    } catch (error) {
      errors.push(error);
    }
  }
  expect(errors).toEqual([
    new ValidationError({ credentials: ["Неверный логин или пароль"] }),
    new ValidationError({ credentials: ["Неверный логин или пароль"] }),
  ]);
  expect(d.passwords.verified).toEqual([
    { hash: "hash:anna-password", password: "wrong" },
    { hash: "hash:dummy", password: "wrong" },
  ]);
  expect(d.sessions.records.size).toBe(0);
});

it.each([
  { key: "pair", limit: 5 },
  { key: "ip", limit: 20 },
  { key: "login", limit: 50 },
])(
  "после $limit ошибок блокирует $key до verify и снимает блокировку через 15 минут",
  async ({ key, limit }) => {
    const d = setup();
    for (let index = 0; index < limit; index++) {
      await expect(
        d.login.execute({
          ...input,
          login: key === "ip" ? `missing-${index}` : "anna",
          ip: key === "login" ? `192.0.2.${index + 2}` : input.ip,
          password: "wrong",
        }),
      ).rejects.toThrow(ValidationError);
    }
    const verified = d.passwords.verified.length;
    await expect(d.login.execute(input)).rejects.toThrow(RateLimitedError);
    expect(d.passwords.verified).toHaveLength(verified);
    expect(d.logger.warn).toHaveBeenLastCalledWith("login_rate_limited", {
      code: "LOGIN_RATE_LIMITED",
    });
    d.clock.advance(15 * 60 * 1000);
    await expect(d.login.execute(input)).resolves.toMatchObject({
      kind: "student",
    });
  },
);

it("пять ошибок одного посетителя не блокируют Анну с другого IP", async () => {
  const d = setup();
  for (let index = 0; index < 5; index++)
    await expect(
      d.login.execute({ ...input, password: "wrong" }),
    ).rejects.toThrow(ValidationError);
  await expect(
    d.login.execute({ ...input, ip: "192.0.2.2" }),
  ).resolves.toMatchObject({ kind: "student" });
});

it("10 параллельных неверных входов резервируют не более пяти verify", async () => {
  const d = setup();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      d.login.execute({ ...input, password: "wrong" }),
    ),
  );
  expect(d.passwords.verified).toHaveLength(5);
  expect(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof RateLimitedError,
    ),
  ).toHaveLength(5);
  expect(
    d.logger.warn.mock.calls.every(
      ([, context]) => Object.keys(context ?? {}).join() === "code",
    ),
  ).toBe(true);
});

it("внутренняя ошибка освобождает резерв, не создавая неудач входа", async () => {
  const d = setup();
  vi.spyOn(d.passwords, "verify").mockRejectedValueOnce(
    new Error("Тестовая недоступность"),
  );
  await expect(d.login.execute(input)).rejects.toThrow(
    "Тестовая недоступность",
  );
  expect(d.limiter.attempts.size).toBe(0);
});

it("успех не сбрасывает историю логина и IP", async () => {
  const d = setup();
  await expect(
    d.login.execute({ ...input, password: "wrong" }),
  ).rejects.toThrow(ValidationError);
  const before = structuredClone(d.limiter.attempts);
  await d.login.execute(input);
  expect(d.limiter.attempts).toEqual(before);
});

it("сессия продлевается один раз в 15 минут, cookie получает новую дату", async () => {
  const d = setup();
  const { token } = await d.login.execute(input);
  d.clock.advance(14 * 60 * 1000);
  expect(await d.current.execute(token)).toMatchObject({ renewed: false });
  expect(d.sessions.touches).toBe(0);
  d.clock.advance(60 * 1000);
  expect(await d.current.execute(token)).toMatchObject({
    renewed: true,
    expiresAt: "2026-11-11T09:15:00.000Z",
  });
  await d.current.execute(token);
  expect(d.sessions.touches).toBe(1);
});

it("ежедневная активность не продлевает сессию за 30 дней от создания", async () => {
  const d = setup();
  const { token } = await d.login.execute(input);
  for (let day = 1; day <= 29; day++) {
    d.clock.advance(86_400_000);
    expect(await d.current.execute(token)).not.toBeNull();
  }
  expect(await d.current.execute(token)).toMatchObject({
    expiresAt: "2026-12-04T09:00:00.000Z",
  });
  d.clock.advance(86_400_000);
  expect(await d.current.execute(token)).toBeNull();
});

it("новый успешный вход отзывает cookie-сессию, неудачный оставляет её действующей", async () => {
  const d = setup();
  const first = await d.login.execute(input);
  await expect(
    d.login.execute({ ...input, password: "wrong" }, first.token),
  ).rejects.toThrow(ValidationError);
  expect(await d.current.execute(first.token)).not.toBeNull();
  const second = await d.login.execute(
    { ...input, login: "marina", password: "marina-password" },
    first.token,
  );
  expect(await d.current.execute(first.token)).toBeNull();
  expect(await d.current.execute(second.token)).toMatchObject({
    actor: marina,
  });
  expect(d.sessions.records.size).toBe(1);
});

it("30-дневная сессия не даёт Actor даже при ошибочно увеличенном expiresAt", async () => {
  const d = setup();
  const { token } = await d.login.execute(input);
  for (const session of d.sessions.records.values())
    session.expiresAt = "2027-01-01T09:00:00Z";
  d.clock.advance(30 * 86_400_000);
  expect(await d.current.execute(token)).toBeNull();
});

it("истёкшая сессия и отозванный токен не дают Actor", async () => {
  const d = setup();
  const { token } = await d.login.execute(input);
  d.clock.advance(7 * 24 * 60 * 60 * 1000);
  expect(await d.current.execute(token)).toBeNull();
  d.clock.set("2026-11-04T09:00:00Z");
  await d.logout.execute(token);
  expect(await d.current.execute(token)).toBeNull();
  await d.logout.execute(token);
  expect(d.sessions.records.size).toBe(0);
});

it("отсутствующие, повреждённые токены и пользователь без профиля не создают Actor", async () => {
  const d = setup();
  expect(await d.current.execute(undefined)).toBeNull();
  expect(await d.current.execute("bad-token")).toBeNull();
  const { token } = await d.login.execute(input);
  d.users.actors = [];
  expect(await d.current.execute(token)).toBeNull();
});

it("staff Actor содержит только факультеты сотрудника", async () => {
  const d = setup();
  const { token } = await d.login.execute({
    ...input,
    login: "marina",
    password: "marina-password",
  });
  expect(await d.current.execute(token)).toMatchObject({ actor: marina });
  const profile = new GetStaffProfile(d.users);
  expect(await profile.execute(marina)).toEqual({
    fullName: "Марина Петровна",
    faculties: ["ФМО", "ИМП"],
  });
  await expect(profile.execute(anna)).rejects.toThrow(ForbiddenError);
});

it("GetMyProfile принимает только Actor и запрашивает его studentId", async () => {
  const repository = new FakeStudentRepository();
  const profile = new GetMyProfile(repository);
  expect(await profile.execute(anna)).toMatchObject({
    fullName: "Анна Соколова",
  });
  expect(await profile.execute(timur)).toMatchObject({
    fullName: "Тимур Белов",
  });
  expect(repository.calls).toEqual(["anna-student", "timur-student"]);
  await expect(profile.execute(marina)).rejects.toThrow(ForbiddenError);
  repository.profiles.clear();
  await expect(profile.execute(anna)).rejects.toThrow(NotFoundError);
});

it("форма не принимает переданный клиентом userId/studentId", async () => {
  await expect(
    setup().login.execute({ ...input, studentId: "timur-student" }),
  ).rejects.toThrow(ValidationError);
});

describe("безопасный next", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%2fevil.example",
    "/%252fevil.example",
    "/\nevil.example",
    ["/today"],
  ])("отклоняет %s", (path) => {
    expect(safeNextPath(path)).toBeNull();
  });
  it("разрешает локальный адрес и учитывает роль", () => {
    expect(safeNextPath("/profile?tab=main")).toBe("/profile?tab=main");
    expect(loginDestination("student", "/schedule")).toBe("/schedule");
    expect(loginDestination("student", "/staff/requests")).toBe("/today");
    expect(loginDestination("staff", "/today")).toBe("/staff/requests");
  });
});
