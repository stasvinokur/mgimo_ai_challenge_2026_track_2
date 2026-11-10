import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

describe.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL: чтение своего журнала",
  () => {
    it("фильтрует владельца и дату, включает границу, сортирует время/id, применяет limit и не читает tool_calls", async () => {
      const student = await openStudentTestData("anna");
      const other = await openStudentTestData("timur");
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const now = new Date();
      const since = new Date(now.getTime() - 14 * 86_400_000);
      try {
        for (const [userId, at, question] of [
          [student.actor.userId, since, "На границе"],
          [student.actor.userId, new Date(since.getTime() - 1), "Устарело"],
          [other.actor.userId, now, "Чужая запись"],
          [student.actor.userId, now, "Свежая первая"],
          [student.actor.userId, now, "Свежая вторая"],
        ] as const) {
          await new PostgresAssistantJournal(
            () => sql,
            new FakeClock(at.toISOString()),
            ids,
          ).append({
            userId,
            question,
            sources: ["/regulations/certificates#p-3-2"],
            tools: ["draft_request"],
            outcome: "declined",
          });
        }
        const journal = new PostgresAssistantJournal(
          () => sql,
          new FakeClock(now.toISOString()),
          ids,
        );
        const records = await journal.listForUser(
          student.actor.userId,
          since,
          200,
        );
        expect(records.map((record) => record.question)).toEqual([
          "Свежая вторая",
          "Свежая первая",
          "На границе",
        ]);
        expect(records[0]).toEqual({
          at: now.toISOString(),
          question: "Свежая вторая",
          sources: ["/regulations/certificates#p-3-2"],
          outcome: "declined",
        });
        expect(
          await journal.listForUser(student.actor.userId, since, 1),
        ).toEqual([records[0]]);
        expect(
          (await journal.listForUser(other.actor.userId, since, 200)).map(
            (record) => record.question,
          ),
        ).toEqual(["Чужая запись"]);
        expect(await journal.listForUser(ids.next(), since, 200)).toEqual([]);
      } finally {
        await sql`delete from assistant_log where user_id in (${student.actor.userId}, ${other.actor.userId})`;
        await sql.end({ timeout: 1 });
        await student.close();
        await other.close();
      }
    });
  },
);
