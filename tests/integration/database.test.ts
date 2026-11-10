import postgres from "postgres";
import { expect, test } from "vitest";

test("PostgreSQL отвечает на проверочный запрос", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Для integration-тестов требуется DATABASE_URL.");
  }

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    const rows = await sql<{ value: number }[]>`select 1::int as value`;
    expect(rows).toEqual([{ value: 1 }]);
  } finally {
    await sql.end({ timeout: 1 });
  }
});
