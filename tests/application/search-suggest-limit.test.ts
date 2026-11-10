import { expect, it, vi } from "vitest";
import { Login } from "@/application/identity/login";
import type { Actor } from "@/application/ports/actor";
import {
  SUGGESTION_LIMIT,
  SuggestCabinet,
} from "@/application/search/suggest-cabinet";
import {
  ForbiddenError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  LOGIN_LIMITS,
  LOGIN_WINDOW_SEC,
} from "@/domain/identity/session-policy";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import {
  FakeIdentityRepository,
  FakePasswords,
  FakeRateLimiter,
  FakeSessionStore,
  FakeTokens,
} from "../fakes/identity";

const actor: Actor = {
  kind: "student",
  userId: "anna-user",
  studentId: "anna",
  facultyId: "fmo",
};
function setup() {
  const clock = new FakeClock("2026-11-05T09:00:00Z");
  const limiter = new FakeRateLimiter(clock);
  const search = {
    execute: vi.fn(async () => ({ query: "геогр", groups: [] })),
  };
  return {
    clock,
    limiter,
    search,
    suggest: new SuggestCabinet(search, limiter),
  };
}

function setupLogin(d: ReturnType<typeof setup>) {
  const tokens = new FakeTokens();
  // Equal suffixes make namespace separation, rather than hashes, do the work.
  vi.spyOn(tokens, "hash").mockReturnValue(actor.userId);
  const users = new FakeIdentityRepository();
  users.actors = [actor];
  const passwords = new FakePasswords();
  return {
    passwords,
    login: new Login({
      users,
      sessions: new FakeSessionStore(),
      tokens,
      passwords,
      clock: d.clock,
      limiter: d.limiter,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ids: new SequentialIdGenerator(),
      dummyHash: async () => "hash:dummy",
    }),
  };
}

const loginInput = {
  login: "anna",
  password: "anna-password",
  ip: "192.0.2.1",
};

it("30 конкурентных запросов запускают поиск ровно 20 раз; следующий отклоняется", async () => {
  const d = setup();
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, () => d.suggest.execute(actor, { q: "геогр" })),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(SUGGESTION_LIMIT);
  for (const result of results)
    if (result.status === "rejected")
      expect(result.reason).toBeInstanceOf(RateLimitedError);
  expect(d.search.execute).toHaveBeenCalledTimes(SUGGESTION_LIMIT);
  await expect(d.suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
    RateLimitedError,
  );
  expect([...d.limiter.attempts.keys()]).toEqual(["search-suggest:anna-user"]);
});

it("ключ — userId; другой studentId не сбрасывает лимит, другой пользователь имеет свой", async () => {
  const d = setup();
  for (let i = 0; i < SUGGESTION_LIMIT; i++)
    await d.suggest.execute(actor, { q: "геогр" });
  await expect(
    d.suggest.execute({ ...actor, studentId: "forged" }, { q: "геогр" }),
  ).rejects.toThrow(RateLimitedError);
  await expect(
    d.suggest.execute(
      { ...actor, userId: "timur-user", studentId: "timur" },
      { q: "геогр" },
    ),
  ).resolves.toHaveProperty("query", "геогр");
});

it("окно сохраняется до 10 секунд и освобождается ровно на границе", async () => {
  const d = setup();
  for (let i = 0; i < SUGGESTION_LIMIT; i++)
    await d.suggest.execute(actor, { q: "геогр" });
  d.clock.advance(9999);
  await expect(d.suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
    RateLimitedError,
  );
  d.clock.advance(1);
  await expect(
    d.suggest.execute(actor, { q: "геогр" }),
  ).resolves.toHaveProperty("query");
});

it("ошибка источника тоже занимает слот, release не вызывается", async () => {
  const d = setup();
  d.search.execute.mockRejectedValue(new Error("source unavailable"));
  await Promise.allSettled(
    Array.from({ length: SUGGESTION_LIMIT }, () =>
      d.suggest.execute(actor, { q: "геогр" }),
    ),
  );
  await expect(d.suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
    RateLimitedError,
  );
  expect(d.search.execute).toHaveBeenCalledTimes(SUGGESTION_LIMIT);
});

it("исчерпанный лимит подсказок не мешает входу того же пользователя и не сбрасывается входом", async () => {
  const d = setup();
  const { login } = setupLogin(d);
  for (let i = 0; i < SUGGESTION_LIMIT; i++)
    await d.suggest.execute(actor, { q: "геогр" });
  await expect(d.suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
    RateLimitedError,
  );
  await expect(login.execute(loginInput)).resolves.toMatchObject({
    kind: "student",
  });
  await expect(d.suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
    RateLimitedError,
  );
  expect([...d.limiter.attempts.keys()]).toEqual([
    `search-suggest:${actor.userId}`,
  ]);
});

it.each(["pair", "ip", "login"] as const)(
  "исчерпанный лимит входа %s не блокирует подсказки того же пользователя",
  async (prefix) => {
    const d = setup();
    const { login, passwords } = setupLogin(d);
    const rule = {
      key: `${prefix}:${actor.userId}`,
      limit: LOGIN_LIMITS[prefix],
      windowSec: LOGIN_WINDOW_SEC,
    };
    for (let i = 0; i < rule.limit; i++) {
      const reservation = await d.limiter.reserve([rule]);
      expect(reservation).not.toBeNull();
      await reservation?.commitFailure();
    }
    await expect(login.execute(loginInput)).rejects.toThrow(RateLimitedError);
    expect(passwords.verified).toEqual([]);
    await expect(
      d.suggest.execute(actor, { q: "геогр" }),
    ).resolves.toHaveProperty("query", "геогр");
    await expect(login.execute(loginInput)).rejects.toThrow(RateLimitedError);
    expect([...d.limiter.attempts.keys()].sort()).toEqual(
      [rule.key, `search-suggest:${actor.userId}`].sort(),
    );
  },
);

it.each([null, "а", "\u0000\u0000", "\nгеогр"])(
  "невалидный q %j не занимает слот и не запускает поиск",
  async (q) => {
    const d = setup();
    await expect(d.suggest.execute(actor, { q })).rejects.toThrow(
      ValidationError,
    );
    expect(d.limiter.attempts.size).toBe(0);
    expect(d.search.execute).not.toHaveBeenCalled();
  },
);

it.each([
  { kind: "staff", userId: "staff-user", staffId: "staff", facultyIds: [] },
  { kind: "teacher", userId: "teacher-user", teacherId: "teacher" },
] satisfies Actor[])(
  "роль $kind отклоняется до лимита и схемы",
  async (other) => {
    const d = setup();
    await expect(d.suggest.execute(other, {})).rejects.toThrow(ForbiddenError);
    expect(d.limiter.attempts.size).toBe(0);
    expect(d.search.execute).not.toHaveBeenCalled();
  },
);
