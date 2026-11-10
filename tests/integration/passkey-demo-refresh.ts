import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql, TransactionSql } from "postgres";
import type { Clock } from "@/application/ports/clock";
import { pruneDemoIdentity } from "../../scripts/seed";

export async function withIsolatedDemoRefresh(
  sql: Sql,
  clock: Clock,
  inspect: (tx: TransactionSql) => Promise<void>,
): Promise<void> {
  const rollback = new Error("Откат изолированного обновления демо-данных");
  try {
    await sql.begin(async (tx) => {
      // Keep pruning and inspection on one connection without refreshing shared data.
      const database = Object.assign(tx, {
        options: sql.options,
      }) as unknown as Sql;
      const pruning = drizzle(database);
      await pruneDemoIdentity(pruning, clock.now());
      await pruneDemoIdentity(pruning, clock.now());
      await inspect(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
