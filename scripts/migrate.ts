import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../src/infrastructure/db/client";

async function main() {
  const sql = createDatabase(1);
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)),
    });
    console.info("Миграции применены.");
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch(() => {
  console.error(
    "Не удалось применить миграции. Проверьте окружение и доступность БД.",
  );
  process.exitCode = 1;
});
