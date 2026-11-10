import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { getDatabase } from "../../src/infrastructure/db/client";
import { isDatabaseAvailable } from "../../src/infrastructure/db/health";

const run = promisify(execFile);

describe.skipIf(!process.env.DATABASE_URL)(
  "Служебные команды с PostgreSQL",
  () => {
    afterAll(async () => {
      await getDatabase().end({ timeout: 1 });
    });

    it("health выполняет настоящий запрос", async () => {
      expect(await isDatabaseAvailable()).toBe(true);
    });

    it("миграции, сид и обновление демо допускают повторный запуск", async () => {
      for (let iteration = 0; iteration < 2; iteration++) {
        for (const script of ["migrate", "seed", "demo-refresh"]) {
          const result = await run("pnpm", [
            "exec",
            "tsx",
            `scripts/${script}.ts`,
          ]);
          expect(result.stdout).not.toBe("");
        }
      }
    }, 30_000);
  },
);
