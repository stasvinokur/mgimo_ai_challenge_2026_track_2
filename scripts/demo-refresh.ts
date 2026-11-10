import { createDatabase } from "../src/infrastructure/db/client";
import { refreshDemo } from "./seed";

async function main() {
  const sql = createDatabase(1);
  try {
    await refreshDemo(sql);
    console.info("Демо-даты обновлены. Пользовательские записи сохранены.");
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch(() => {
  console.error(
    "Не удалось обновить демо-даты. Проверьте окружение и доступность БД.",
  );
  process.exitCode = 1;
});
