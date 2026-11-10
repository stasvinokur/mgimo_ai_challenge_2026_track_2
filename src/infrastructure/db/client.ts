import postgres from "postgres";
import { z } from "zod";

const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/, hostname: /./ });

export function getDatabaseUrl(): string {
  const result = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!result.success) {
    throw new Error("Задайте корректный DATABASE_URL для PostgreSQL.");
  }
  return result.data;
}

export function normalizeDatabaseValue(
  value: unknown,
  column: Pick<postgres.Column<string>, "type">,
): unknown {
  if (column.type !== 1184 || value === null) return value;
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new Error("Некорректная временная метка БД.");
  }
  return date;
}

export function createDatabase(max = 10) {
  return postgres(getDatabaseUrl(), {
    max,
    connect_timeout: 2,
    idle_timeout: 20,
    connection: { statement_timeout: 2_000 },
    // Drizzle replaces driver codecs; normalize timestamptz after decoding.
    transform: { value: { from: normalizeDatabaseValue } },
    onnotice: () => {},
  });
}

let database: ReturnType<typeof createDatabase> | undefined;

export function getDatabase() {
  database ??= createDatabase();
  return database;
}
