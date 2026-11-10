import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { seedDemo } from "../../scripts/seed";
import { createDatabase } from "../../src/infrastructure/db/client";

// Integration files share one database. Prepare it once, like scripts/wt-db.sh,
// instead of relying on a migrating file happening to run first (CI has no order cache).
export default async function setup() {
  if (!process.env.DATABASE_URL) return;
  const sql = createDatabase(1);
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(
        new URL("../../drizzle/", import.meta.url),
      ),
    });
    await seedDemo(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
