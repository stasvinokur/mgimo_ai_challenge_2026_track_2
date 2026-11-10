import { expect, it, vi } from "vitest";
import { Login } from "@/application/identity/login";
import {
  SUGGESTION_LIMIT,
  SuggestCabinet,
} from "@/application/search/suggest-cabinet";
import { RateLimitedError } from "@/application/shared/errors";
import {
  LOGIN_LIMITS,
  LOGIN_WINDOW_SEC,
} from "@/domain/identity/session-policy";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import {
  FakeIdentityRepository,
  FakePasswords,
  FakeSessionStore,
  FakeTokens,
} from "../fakes/identity";

it.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL: два экземпляра подсказок атомарно делят 20 слотов",
  async () => {
    const sql = createDatabase(4);
    const ids = new UuidV7Generator();
    const userId = ids.next();
    const actor = {
      kind: "student" as const,
      userId,
      studentId: ids.next(),
      facultyId: ids.next(),
    };
    const key = `search-suggest:${userId}`;
    const clock = new FakeClock("2026-11-05T09:00:00Z");
    const execute = vi.fn(async () => ({ query: "геогр", groups: [] }));
    const first = new SuggestCabinet(
      { execute },
      new PostgresRateLimiter(() => sql, clock, ids),
    );
    const second = new SuggestCabinet(
      { execute },
      new PostgresRateLimiter(() => sql, clock, ids),
    );
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 30 }, (_, i) =>
          (i % 2 ? first : second).execute(actor, { q: "геогр" }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(SUGGESTION_LIMIT);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toBeInstanceOf(RateLimitedError);
      expect(execute).toHaveBeenCalledTimes(SUGGESTION_LIMIT);
      const [row] = await sql<
        { count: number }[]
      >`select count(*)::int as count from login_attempts where key = ${key}`;
      expect(row?.count).toBe(SUGGESTION_LIMIT);
      clock.advance(10_000);
      await expect(
        second.execute(actor, { q: "геогр" }),
      ).resolves.toHaveProperty("query");
    } finally {
      await sql`delete from login_attempts where key = ${key}`;
      await sql.end({ timeout: 1 });
    }
  },
);

it.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL: лимиты подсказок и входа изолированы даже при одинаковом суффиксе ключей",
  async () => {
    const sql = createDatabase(2);
    const ids = new UuidV7Generator();
    const actor = {
      kind: "student" as const,
      userId: ids.next(),
      studentId: ids.next(),
      facultyId: ids.next(),
    };
    const clock = new FakeClock("2026-11-05T09:00:00Z");
    const limiter = new PostgresRateLimiter(() => sql, clock, ids);
    const suggest = new SuggestCabinet(
      { execute: vi.fn(async () => ({ query: "геогр", groups: [] })) },
      limiter,
    );
    const users = new FakeIdentityRepository();
    users.credentials.set("anna", {
      userId: actor.userId,
      passwordHash: "hash:anna-password",
    });
    users.actors = [actor];
    const tokens = new FakeTokens();
    vi.spyOn(tokens, "hash").mockReturnValue(actor.userId);
    const passwords = new FakePasswords();
    const login = new Login({
      users,
      sessions: new FakeSessionStore(),
      tokens,
      passwords,
      clock,
      limiter,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ids,
      dummyHash: async () => "hash:dummy",
    });
    const input = {
      login: "anna",
      password: "anna-password",
      ip: "192.0.2.1",
    };
    const keys = ["search-suggest", "pair", "ip", "login"].map(
      (prefix) => `${prefix}:${actor.userId}`,
    );
    async function clear() {
      await sql`delete from login_attempts where key = any(${keys}::text[])`;
    }
    try {
      for (let i = 0; i < SUGGESTION_LIMIT; i++)
        await suggest.execute(actor, { q: "геогр" });
      await expect(suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
        RateLimitedError,
      );
      await expect(login.execute(input)).resolves.toMatchObject({
        kind: "student",
      });
      await expect(suggest.execute(actor, { q: "геогр" })).rejects.toThrow(
        RateLimitedError,
      );
      const rows = await sql<
        { key: string; count: number }[]
      >`select key, count(*)::int as count from login_attempts where key = any(${keys}::text[]) group by key`;
      expect(rows).toEqual([
        { key: `search-suggest:${actor.userId}`, count: SUGGESTION_LIMIT },
      ]);
      for (const prefix of ["pair", "ip", "login"] as const) {
        await clear();
        const rule = {
          key: `${prefix}:${actor.userId}`,
          limit: LOGIN_LIMITS[prefix],
          windowSec: LOGIN_WINDOW_SEC,
        };
        for (let i = 0; i < rule.limit; i++) {
          const reservation = await limiter.reserve([rule]);
          expect(reservation).not.toBeNull();
          await reservation?.commitFailure();
        }
        await expect(login.execute(input)).rejects.toThrow(RateLimitedError);
        await expect(
          suggest.execute(actor, { q: "геогр" }),
        ).resolves.toHaveProperty("query", "геогр");
        await expect(login.execute(input)).rejects.toThrow(RateLimitedError);
      }
      expect(passwords.verified).toHaveLength(1);
    } finally {
      await clear();
      await sql.end({ timeout: 1 });
    }
  },
);
