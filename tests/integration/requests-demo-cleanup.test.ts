import { describe, expect, it } from "vitest";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { cleanupIdentity } from "../../scripts/cleanup-identity";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL: очистка счётчиков заявок демо-студента",
  () => {
    it("cleanup соблюдает окна 24 часа и 15 минут", async () => {
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const tokens = new CryptoSessionTokens();
      const now = new Date();
      const clock = new FakeClock(now.toISOString());
      const scenarios = [
        { prefix: "request-submission:pair", age: 3_600_000, keep: true },
        { prefix: "request-submission:student", age: 86_399_999, keep: true },
        { prefix: "request-submission:pair", age: 86_400_000, keep: false },
        { prefix: "request-submission:student", age: 86_400_001, keep: false },
        { prefix: "request-submission:pair", age: 0, keep: true },
        { prefix: "attendance:mark", age: 3_600_000, keep: false },
        { prefix: "other:request-submission", age: 3_600_000, keep: false },
        ...["pair", "ip", "login"].flatMap((prefix) => [
          { prefix, age: 900_000, keep: false },
          { prefix, age: 899_999, keep: true },
        ]),
      ].map((scenario) => ({
        ...scenario,
        id: ids.next(),
        key: `${scenario.prefix}:${tokens.hash(ids.next())}`,
      }));
      try {
        for (const row of scenarios)
          await sql`insert into login_attempts (id, key, at)
            values (${row.id}, ${row.key}, ${new Date(now.getTime() - row.age).toISOString()}::timestamptz)`;
        await cleanupIdentity(sql, now);
        for (const row of scenarios) {
          const saved =
            await sql`select id from login_attempts where id = ${row.id}`;
          expect(saved).toEqual(row.keep ? [{ id: row.id }] : []);
        }
        const pair = scenarios[0];
        if (!pair) throw new Error("Нет счётчика пары студент/IP.");
        const limiter = new PostgresRateLimiter(() => sql, clock, ids);
        expect(
          await limiter.reserve([
            { key: pair.key, limit: 1, windowSec: 86_400 },
          ]),
        ).toBeNull();
      } finally {
        for (const row of scenarios)
          await sql`delete from login_attempts where id = ${row.id}`;
        await sql.end({ timeout: 1 });
      }
    });
  },
);
