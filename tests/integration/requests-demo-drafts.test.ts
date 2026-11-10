import { drizzle } from "drizzle-orm/postgres-js";
import { expect, it } from "vitest";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { RequestDraftLimit } from "@/application/requests/draft-limit";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import * as schema from "@/infrastructure/db/schema";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

const input = {
  typeCode: "enrollment",
  payload: { destination: "Учебный центр" },
};

async function fixture(demo = true, connections = 1) {
  const student = await openStudentTestData("anna");
  const sql = createDatabase(connections);
  const ids = new UuidV7Generator();
  const clock = new FakeClock("2026-11-06T09:00:00Z");
  const tokens = new CryptoSessionTokens();
  const repo = new DrizzleRequestRepository(() => drizzle(sql, { schema }));
  const uow = new DrizzleRequestsUnitOfWork(() => sql, ids);
  const quota = new RequestDraftLimit(
    repo,
    new PostgresRateLimiter(() => sql, clock, ids),
    tokens,
    () => "192.0.2.41",
  );
  const actor = student.actor;
  try {
    await sql`delete from requests where student_id = ${actor.studentId}`;
    if (demo)
      await sql`update users set seed_key = ${`draft-demo:${actor.userId}`} where id = ${actor.userId}`;
    return {
      sql,
      clock,
      repo,
      actor,
      ids,
      create: new CreateRequestDraft(uow, clock, ids, quota),
      bootstrap: new CreateRequestDraft(uow, clock, ids),
      submit: new SubmitRequest(new ChangeRequestStatus(uow, clock, ids)),
      async close() {
        await sql`delete from login_attempts where key = any(${[
          "192.0.2.41",
          "192.0.2.42",
          "192.0.2.43",
        ].map(
          (ip) =>
            `request-draft:pair:${tokens.hash(`${actor.studentId}\0${ip}`)}`,
        )}::text[])`;
        await student.close();
        await sql.end({ timeout: 1 });
      },
    };
  } catch (error) {
    await student.close();
    await sql.end({ timeout: 1 });
    throw error;
  }
}

it("демо: вытеснение не трогает seed_key и при max=1 сохраняет IP-квоту", async () => {
  const f = await fixture();
  try {
    const seeded = await f.bootstrap.execute(f.actor, input);
    await f.sql`update requests set seed_key = ${`draft-demo:request:${seeded.id}`} where id = ${seeded.id}`;
    const unseeded: string[] = [];
    for (let i = 0; i < 19; i++) {
      f.clock.advance(1);
      unseeded.push((await f.bootstrap.execute(f.actor, input)).id);
    }
    const next = await f.create.execute(f.actor, input);
    const records = await f.repo.listForStudent(f.actor.studentId);
    expect(records).toHaveLength(20);
    expect(records.map((row) => row.id)).toContain(seeded.id);
    expect(records.map((row) => row.id)).toContain(next.id);
    expect(records.map((row) => row.id)).not.toContain(unseeded[0]);
    for (let i = 0; i < 19; i++) await f.create.execute(f.actor, input);
    await expect(f.create.execute(f.actor, input)).rejects.toThrow(
      RateLimitedError,
    );
    await expect(
      f.create.execute(f.actor, input, "192.0.2.42"),
    ).resolves.toHaveProperty("id");
    const keys = await f.sql<
      { key: string }[]
    >`select key from login_attempts where key like 'request-draft:%'`;
    expect(
      keys.every((row) => /^request-draft:pair:[a-f0-9]{64}$/.test(row.key)),
    ).toBe(true);
    expect(keys.every((row) => !row.key.includes("192.0.2."))).toBe(true);
    expect(await f.repo.listForStudent(f.actor.studentId)).toHaveLength(20);
  } finally {
    await f.close();
  }
});

it("обычный предел20 и полностью засеянная очередь не удаляют черновики", async () => {
  const f = await fixture(false);
  try {
    for (let i = 0; i < 20; i++) await f.create.execute(f.actor, input);
    const before = await f.repo.listForStudent(f.actor.studentId);
    await expect(f.create.execute(f.actor, input)).rejects.toThrow(
      RateLimitedError,
    );
    expect(await f.repo.listForStudent(f.actor.studentId)).toEqual(before);
    await f.sql`update users set seed_key = ${`draft-demo:${f.actor.userId}`} where id = ${f.actor.userId}`;
    await f.sql`update requests set seed_key = 'draft-demo:request:' || id::text where student_id = ${f.actor.studentId}`;
    await expect(f.create.execute(f.actor, input)).rejects.toThrow(
      RateLimitedError,
    );
    expect(await f.repo.listForStudent(f.actor.studentId)).toEqual(before);
  } finally {
    await f.close();
  }
});

it("конкурентные создания и отправка сериализуются без превышения20 и deadlock", async () => {
  const f = await fixture(true, 10);
  try {
    for (let i = 0; i < 19; i++) await f.bootstrap.execute(f.actor, input);
    const created = await Promise.all([
      f.create.execute(f.actor, input, "192.0.2.41"),
      f.create.execute(f.actor, input, "192.0.2.42"),
      f.create.execute(f.actor, input, "192.0.2.43"),
    ]);
    const records = await f.repo.listForStudent(f.actor.studentId);
    expect(records).toHaveLength(20);
    for (const row of created)
      expect(records.map((record) => record.id)).toContain(row.id);
    const oldest = [...records].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )[0];
    if (!oldest) throw new Error("Нет старого черновика.");
    const results = await Promise.allSettled([
      f.create.execute(f.actor, input),
      f.submit.execute(f.actor, { id: oldest.id }),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toBeInstanceOf(NotFoundError);
    expect(
      (await f.repo.listForStudent(f.actor.studentId)).filter(
        (row) => row.status === "draft",
      ),
    ).toHaveLength(20);
  } finally {
    await f.close();
  }
});
