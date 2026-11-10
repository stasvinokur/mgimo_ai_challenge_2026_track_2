import { drizzle } from "drizzle-orm/postgres-js";
import { expect, it } from "vitest";
import { SubmitApprovedDraft } from "@/application/assistant/submit-approved";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { RequestSubmissionLimit } from "@/application/requests/submission-limit";
import { RateLimitedError } from "@/application/shared/errors";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import * as schema from "@/infrastructure/db/schema";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { cleanupIdentity } from "../../scripts/cleanup-identity";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

it("демо-квота атомарна на IP, общая для ассистента и формы; обычная прежняя", async () => {
  const student = await openStudentTestData("anna");
  // A single connection also catches a quota reservation nested inside the approval transaction.
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const clock = new FakeClock("2026-11-06T09:00:00Z");
  const tokens = new CryptoSessionTokens();
  const repo = new DrizzleRequestRepository(() => drizzle(sql, { schema }));
  const uow = new DrizzleRequestsUnitOfWork(() => sql, ids);
  const quota = new RequestSubmissionLimit(
    repo,
    new PostgresRateLimiter(() => sql, clock, ids),
    tokens,
    () => "192.0.2.10",
  );
  const change = new ChangeRequestStatus(uow, clock, ids, quota);
  const submit = new SubmitRequest(change);
  const approved = new SubmitApprovedDraft(uow, clock, ids, quota);
  const create = new CreateRequestDraft(uow, clock, ids);
  const actor = student.actor;
  const draft = () =>
    create.execute(actor, {
      typeCode: "enrollment",
      payload: { destination: "Учебная организация" },
    });
  const pairKey = `request-submission:pair:${tokens.hash(`${actor.studentId}\0${"192.0.2.10"}`)}`;
  const otherKey = `request-submission:pair:${tokens.hash(`${actor.studentId}\0${"192.0.2.11"}`)}`;
  const studentKey = `request-submission:student:${tokens.hash(actor.studentId)}`;
  try {
    await sql`update users set seed_key = ${`requests-demo:${ids.next()}`} where id = ${actor.userId}`;
    for (let i = 0; i < 19; i++) await submit.execute(actor, await draft());
    const first = await draft(),
      second = await draft();
    const results = await Promise.allSettled([
      submit.execute(actor, first),
      submit.execute(actor, second),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: expect.any(RateLimitedError),
    });
    const remaining = (await repo.listForStudent(actor.studentId)).find(
      (r) => r.id === first.id || r.id === second.id,
    );
    const blocked = (await repo.listForStudent(actor.studentId)).find(
      (r) => r.status === "draft" && (r.id === first.id || r.id === second.id),
    );
    expect(remaining).toBeTruthy();
    if (!blocked) throw new Error("Нет оставшегося черновика");
    const approval = {
      id: ids.next(),
      draftId: blocked.id,
      updatedAt: blocked.updatedAt,
      payload: blocked.payload,
    };
    clock.advance(16 * 60 * 1000);
    await cleanupIdentity(sql, clock.now());
    await expect(submit.execute(actor, { id: blocked.id })).rejects.toThrow(
      RateLimitedError,
    );
    await expect(
      approved.execute(actor, approval, "192.0.2.10"),
    ).rejects.toThrow(RateLimitedError);
    await expect(
      approved.execute(actor, approval, "192.0.2.11"),
    ).resolves.toMatchObject({ status: "submitted" });
    const keys = await sql<
      { key: string }[]
    >`select key from login_attempts where key in (${pairKey}, ${otherKey}, ${studentKey})`;
    expect(keys.filter((row) => row.key === pairKey)).toHaveLength(20);
    expect(keys.filter((row) => row.key === otherKey)).toHaveLength(1);
    expect(keys.filter((row) => row.key === studentKey)).toHaveLength(21);
    for (const row of keys) {
      expect(row.key).not.toContain("192.0.2.");
      expect(row.key).toMatch(
        /^request-submission:(pair|student):[a-f0-9]{64}$/,
      );
    }
    await sql`update users set seed_key = null where id = ${actor.userId}`;
    await expect(
      submit.execute(actor, await draft(), "192.0.2.12"),
    ).rejects.toThrow(RateLimitedError);
  } finally {
    await sql`delete from login_attempts where key in (${pairKey}, ${otherKey}, ${studentKey})`;
    await student.close();
    await sql.end({ timeout: 1 });
  }
});

it("предохранитель200 освобождается ровно через час, IP-квота20 остаётся суточной", async () => {
  const student = await openStudentTestData("anna");
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const tokens = new CryptoSessionTokens();
  const clock = new FakeClock("2026-11-06T09:00:00Z");
  const repo = new DrizzleRequestRepository(() => drizzle(sql, { schema }));
  const quota = new RequestSubmissionLimit(
    repo,
    new PostgresRateLimiter(() => sql, clock, ids),
    tokens,
    () => "192.0.2.1",
  );
  const actor = student.actor;
  const keys = new Set<string>([
    `request-submission:student:${tokens.hash(actor.studentId)}`,
  ]);
  try {
    await sql`update users set seed_key = ${`requests-demo:${ids.next()}`} where id = ${actor.userId}`;
    for (let i = 0; i < 200; i++) {
      const ip = i < 20 ? "192.0.2.1" : `192.0.2.${i}`;
      keys.add(
        `request-submission:pair:${tokens.hash(`${actor.studentId}\0${ip}`)}`,
      );
      const reservation = await quota.reserve(actor, ip);
      await reservation?.commitFailure();
    }
    await expect(quota.reserve(actor, "198.51.100.1")).rejects.toThrow(
      RateLimitedError,
    );
    clock.advance(3_600_000 - 1);
    await expect(quota.reserve(actor, "198.51.100.1")).rejects.toThrow(
      RateLimitedError,
    );
    clock.advance(1);
    await cleanupIdentity(sql, clock.now());
    await expect(quota.reserve(actor, "192.0.2.1")).rejects.toThrow(
      RateLimitedError,
    );
    keys.add(
      `request-submission:pair:${tokens.hash(`${actor.studentId}\0${"198.51.100.1"}`)}`,
    );
    const reservation = await quota.reserve(actor, "198.51.100.1");
    expect(reservation).toBeTruthy();
    await reservation?.commitFailure();
  } finally {
    await sql`delete from login_attempts where key = any(${[...keys]}::text[])`;
    await student.close();
    await sql.end({ timeout: 1 });
  }
});
