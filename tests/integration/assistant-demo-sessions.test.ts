import { describe, expect, it } from "vitest";
import { GetMyAssistantJournal } from "@/application/assistant/get-my-journal";
import { GetRegulation } from "@/application/regulations/use-cases";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { FakeRegulations } from "../fakes/regulations";
import { openStudentTestData } from "./student-e2e-data";

describe.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL: сессии журнала демо-студента",
  () => {
    it("внешний ключ session_id имеет индекс с session_id первым столбцом", async () => {
      const sql = createDatabase(1);
      try {
        const indexes = await sql<{ name: string }[]>`
          select index_class.relname as name
          from pg_index i
          join pg_class table_class on table_class.oid = i.indrelid
          join pg_class index_class on index_class.oid = i.indexrelid
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where table_class.oid = 'public.assistant_log'::regclass
            and a.attname = 'session_id' and i.indisvalid and i.indisready`;
        expect(indexes).toContainEqual({
          name: "assistant_log_session_user_at_idx",
        });
      } finally {
        await sql.end({ timeout: 1 });
      }
    });

    it("разделяет посетителей, скрывает старые строки без сессии и сохраняет обычный журнал после отзыва", async () => {
      const student = await openStudentTestData("anna");
      const other = await openStudentTestData("timur");
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const tokens = new CryptoSessionTokens();
      const clock = new FakeClock("2026-11-06T09:00:00Z");
      const journal = new PostgresAssistantJournal(() => sql, clock, ids);
      const query = new GetMyAssistantJournal(
        journal,
        new GetRegulation(new FakeRegulations()),
        clock,
        tokens,
      );
      async function session(userId: string, ageDays = 0, expired = false) {
        const token = tokens.generate();
        const id = ids.next();
        await sql`insert into sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
        values (${id}, ${userId}, ${tokens.hash(token)},
          ${new Date(clock.now().getTime() - ageDays * 86_400_000).toISOString()}::timestamptz,
          ${new Date(clock.now().getTime() + (expired ? 0 : 86_400_000)).toISOString()}::timestamptz,
          ${clock.now().toISOString()}::timestamptz)`;
        return { token, id };
      }
      async function append(question: string, token?: string) {
        await journal.append({
          userId: student.actor.userId,
          sessionTokenHash: token ? tokens.hash(token) : null,
          question,
          tools: [],
          sources: [],
          outcome: "answered",
        });
      }
      try {
        await sql`update users set seed_key = ${`assistant-demo:${student.actor.userId}`} where id = ${student.actor.userId}`;
        const a = await session(student.actor.userId);
        const b = await session(student.actor.userId);
        const foreign = await session(other.actor.userId);
        const expired = await session(student.actor.userId, 0, true);
        const absoluteExpired = await session(student.actor.userId, 31);
        await append("Запись до миграции");
        await append("Первый посетитель", a.token);
        await append("Второй посетитель", b.token);
        await append("Чужой токен", foreign.token);
        await append("Истёкшая сессия", expired.token);
        await append("Абсолютный срок", absoluteExpired.token);
        expect(
          (await query.execute(student.actor, a.token)).map(
            (entry) => entry.question,
          ),
        ).toEqual(["Первый посетитель"]);
        expect(
          (await query.execute(student.actor, b.token)).map(
            (entry) => entry.question,
          ),
        ).toEqual(["Второй посетитель"]);
        for (const token of [
          undefined,
          tokens.generate(),
          foreign.token,
          expired.token,
          absoluteExpired.token,
        ])
          expect(await query.execute(student.actor, token)).toEqual([]);
        const rows = await sql<
          { question: string; sessionId: string | null }[]
        >`
        select question, session_id as "sessionId" from assistant_log where user_id = ${student.actor.userId} order by id`;
        expect(rows.filter((row) => row.sessionId !== null)).toEqual([
          { question: "Первый посетитель", sessionId: a.id },
          { question: "Второй посетитель", sessionId: b.id },
        ]);
        await sql`delete from sessions where id = ${a.id}`;
        await append("Поток завершился после отзыва", a.token);
        expect(await query.execute(student.actor, a.token)).toEqual([]);
        expect(await query.execute(student.actor, b.token)).toHaveLength(1);
        const [revoked] = await sql<{ sessionId: string | null }[]>`
        select session_id as "sessionId" from assistant_log where user_id = ${student.actor.userId} and question = 'Первый посетитель'`;
        expect(revoked?.sessionId).toBeNull();
        await sql`update users set seed_key = null where id = ${student.actor.userId}`;
        expect(await query.execute(student.actor, b.token)).toHaveLength(7);
        expect(await query.execute(student.actor)).toHaveLength(7);
      } finally {
        await sql.end({ timeout: 1 });
        await student.close();
        await other.close();
      }
    });
  },
);
