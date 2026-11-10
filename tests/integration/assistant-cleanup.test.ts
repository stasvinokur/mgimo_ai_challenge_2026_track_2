import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { cleanupIdentity } from "../../scripts/cleanup-identity";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

describe.skipIf(!process.env.DATABASE_URL)(
  "Очистка журнала ассистента на PostgreSQL",
  () => {
    it("удаляет записи старше 14 дней, сохраняет границу и свежие, возвращает счётчик", async () => {
      const student = await openStudentTestData("anna");
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const now = new Date();
      const cutoff = new Date(now.getTime() - 14 * 86_400_000);
      try {
        for (const [question, at] of [
          ["Старая запись", new Date(cutoff.getTime() - 1)],
          ["Ровно 14 дней", cutoff],
          ["Младше границы", new Date(cutoff.getTime() + 1)],
          ["Свежая запись", now],
        ] as const) {
          await new PostgresAssistantJournal(
            () => sql,
            new FakeClock(at.toISOString()),
            ids,
          ).append({
            userId: student.actor.userId,
            question,
            tools: [],
            sources: [],
            outcome: "answered",
          });
        }
        const [old] =
          await sql`select count(*)::int as n from assistant_log where at < ${cutoff.toISOString()}::timestamptz`;
        const result = await cleanupIdentity(sql, now);
        expect(result.assistantLogs).toBe(old?.n);
        expect(result.assistantLogs).toBeGreaterThanOrEqual(1);
        const remaining =
          await sql`select question from assistant_log where user_id = ${student.actor.userId} order by at`;
        expect(remaining.map((row) => row.question)).toEqual([
          "Ровно 14 дней",
          "Младше границы",
          "Свежая запись",
        ]);
      } finally {
        await sql`delete from assistant_log where user_id = ${student.actor.userId}`;
        await sql.end({ timeout: 1 });
        await student.close();
      }
    });
  },
);
