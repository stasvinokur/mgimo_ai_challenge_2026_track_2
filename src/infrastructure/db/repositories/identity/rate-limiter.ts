import type { Sql } from "postgres";
import type { Clock } from "@/application/ports/clock";
import type { IdGenerator } from "@/application/ports/id-generator";
import type {
  RateLimiter,
  RateLimitReservation,
  RateLimitRule,
} from "@/application/ports/rate-limiter";

export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly database: () => Sql,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async reserve(
    rules: readonly RateLimitRule[],
  ): Promise<RateLimitReservation | null> {
    const sorted = [...rules].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    const database = this.database();
    const ids = await database.begin(async (sql) => {
      // Every contender locks all keys in the same order, before counting.
      for (const rule of sorted)
        await sql`select pg_advisory_xact_lock(hashtextextended(${rule.key}, 0))`;
      const now = this.clock.now();
      for (const rule of sorted) {
        const cutoff = new Date(
          now.getTime() - rule.windowSec * 1000,
        ).toISOString();
        const [row] = await sql<
          { count: number }[]
        >`select count(*)::int as count from login_attempts where key = ${rule.key} and at > ${cutoff}::timestamptz`;
        if ((row?.count ?? 0) >= rule.limit) return null;
      }
      const reserved: string[] = [];
      for (const rule of sorted) {
        const id = this.ids.next();
        await sql`insert into login_attempts (id, key, at) values (${id}, ${rule.key}, ${now.toISOString()}::timestamptz)`;
        reserved.push(id);
      }
      return reserved;
    });
    if (!ids) return null;
    let settled = false;
    return {
      async commitFailure() {
        // Reservations are persisted before verify and remain on failure/crash.
        settled = true;
      },
      async release() {
        if (settled) return;
        await database.begin(async (sql) => {
          for (const id of ids)
            await sql`delete from login_attempts where id = ${id}`;
        });
        settled = true;
      },
    };
  }
}
