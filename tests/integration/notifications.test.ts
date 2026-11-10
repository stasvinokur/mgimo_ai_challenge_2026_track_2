import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GetMyNotifications,
  GetMyPulse,
  ReadAllMyNotifications,
  ReadMyNotification,
} from "@/application/notifications/use-cases";
import type { Actor } from "@/application/ports/actor";
import { NotFoundError } from "@/application/shared/errors";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresNotificationsRepository } from "@/infrastructure/db/repositories/notifications/repository";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)("Уведомления PostgreSQL", () => {
  let sql: ReturnType<typeof createDatabase>;
  let anna: Extract<Actor, { kind: "student" }>;
  let timur: Extract<Actor, { kind: "student" }>;
  const clock = new FakeClock("2030-11-04T12:00:00.000Z");
  beforeAll(async () => {
    sql = createDatabase(1);
    async function actor(name: string) {
      const [row] = await sql<
        { studentId: string; userId: string; facultyId: string }[]
      >`
        select id as "studentId", user_id as "userId", faculty_id as "facultyId" from students where seed_key = ${`demo:student:${name}`}`;
      if (!row) throw new Error("Нужен демо-сид БД лейна.");
      return { kind: "student" as const, ...row };
    }
    anna = await actor("anna");
    timur = await actor("timur");
  });
  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });
  async function rollback(
    run: (
      repo: PostgresNotificationsRepository,
      tx: TransactionSql,
    ) => Promise<void>,
  ) {
    const sentinel = Symbol("rollback");
    try {
      await sql.begin(async (tx) => {
        await run(
          new PostgresNotificationsRepository(() => tx as unknown as Sql),
          tx,
        );
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  it("SQL ограничивает ленту, одиночное/массовое прочтение и пульс userId; IDOR ничего не меняет", async () =>
    rollback(async (repo, tx) => {
      const ownId = randomUUID();
      const foreignId = randomUUID();
      const before = await repo.getPulseForUser(anna.userId);
      for (const [id, owner] of [
        [ownId, anna.userId],
        [foreignId, timur.userId],
      ]) {
        await tx`insert into notifications (id, user_id, kind, priority, title, body, link, created_at) values (${id ?? ""}, ${owner ?? ""}, 'change', 'high', 'Тест переноса', 'Вымышленный перенос', '/schedule', '2029-11-04T09:00:00Z')`;
      }
      const pulse = new GetMyPulse(repo);
      expect((await pulse.execute(anna)).unread).toBe(before.unread + 1);
      expect((await pulse.execute(anna)).latestAt).toBe(
        "2029-11-04T09:00:00.000Z",
      );
      expect(
        (await repo.listForUser(anna.userId)).some(
          (item) => item.id === foreignId,
        ),
      ).toBe(false);
      expect(await repo.findByIdForUser(foreignId, anna.userId)).toBeNull();
      expect(
        await repo.markReadForUser(
          foreignId,
          anna.userId,
          clock.now().toISOString(),
        ),
      ).toBe(false);
      const read = new ReadMyNotification(repo, clock);
      await expect(read.execute(anna, { id: foreignId })).rejects.toEqual(
        new NotFoundError(),
      );
      await expect(read.execute(timur, { id: ownId })).rejects.toEqual(
        new NotFoundError(),
      );
      expect(
        (await repo.findByIdForUser(foreignId, timur.userId))?.readAt,
      ).toBeNull();
      expect(await read.execute(anna, { id: ownId, open: true })).toEqual({
        link: "/schedule",
      });
      expect((await pulse.execute(anna)).unread).toBe(before.unread);
      expect((await pulse.execute(anna)).latestAt).toBe(
        clock.now().toISOString(),
      );
      await new ReadAllMyNotifications(repo, clock).execute(anna);
      expect((await pulse.execute(anna)).unread).toBe(0);
      expect(
        (await repo.findByIdForUser(foreignId, timur.userId))?.readAt,
      ).toBeNull();
      expect(
        JSON.parse(
          JSON.stringify(await new GetMyNotifications(repo).execute(anna)),
        ),
      ).toEqual(await new GetMyNotifications(repo).execute(anna));
    }));

  it("SQL выбирает объявления all/своего факультета/курса/группы, не будущие и не чужие", async () =>
    rollback(async (repo, tx) => {
      const profiles = await tx<
        { id: string; faculty: string; course: string; group: string }[]
      >`
      select id, faculty_id::text as faculty, course::text, group_id::text as "group" from students where id in (${anna.studentId}, ${timur.studentId})`;
      const expected: string[] = [];
      const excluded: string[] = [];
      for (const audience of ["all", "faculty", "course", "group"] as const) {
        for (const actor of audience === "all" ? [anna] : [anna, timur]) {
          const profile = profiles.find((item) => item.id === actor.studentId);
          if (!profile) throw new Error("Нет тестового профиля.");
          const id = randomUUID();
          (actor === anna ? expected : excluded).push(id);
          await tx`insert into announcements (id, audience, audience_ref, title, body, published_at) values (${id}, ${audience}, ${audience === "all" ? null : profile[audience]}, 'Тест аудитории', 'Вымышленное объявление', now() - interval '1 minute')`;
        }
      }
      const future = randomUUID();
      excluded.push(future);
      await tx`insert into announcements (id, audience, title, body, published_at) values (${future}, 'all', 'Будущее', 'Вымышленное объявление', now() + interval '1 day')`;
      const before = await repo.getPulseForUser(anna.userId);
      const feed = await new GetMyNotifications(repo).execute(anna);
      const ids = feed.announcements.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining(expected));
      for (const id of excluded) expect(ids).not.toContain(id);
      expect(
        await repo.listAnnouncementsForStudent(timur.studentId, anna.userId),
      ).toEqual([]);
      expect(await repo.getPulseForUser(anna.userId)).toEqual(before);
    }));
});
