import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { SubmitApprovedDraft } from "@/application/assistant/submit-approved";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { RequestSubmissionLimit } from "@/application/requests/submission-limit";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, FakeRateLimiter, marina, timur } from "../fakes/identity";
import { FakeRequests } from "../fakes/requests";

function fixture(demo = true) {
  const db = new FakeRequests();
  if (demo) db.demoUserIds.add(anna.userId);
  const clock = new FakeClock("2026-11-06T09:00:00Z");
  const ids = new SequentialIdGenerator();
  const limiter = new FakeRateLimiter(clock);
  const tokens = {
    hash: (value: string) => createHash("sha256").update(value).digest("hex"),
  };
  const quota = new RequestSubmissionLimit(
    db,
    limiter,
    tokens,
    () => "192.0.2.1",
  );
  const create = new CreateRequestDraft(db, clock, ids);
  const change = new ChangeRequestStatus(db, clock, ids, quota);
  return {
    db,
    clock,
    limiter,
    quota,
    change,
    submit: new SubmitRequest(change),
    approved: new SubmitApprovedDraft(db, clock, ids, quota),
    draft: () =>
      create.execute(anna, {
        typeCode: "enrollment",
        payload: { destination: "Учебный центр" },
      }),
  };
}

it("демо: общий студент не мешает другому IP, форма и ассистент делят одну квоту", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.submit.execute(anna, await f.draft());
  const next = await f.draft();
  await expect(f.submit.execute(anna, next)).rejects.toThrow(RateLimitedError);
  await expect(
    f.submit.execute(anna, { id: "00000000-0000-7000-8000-000000000055" }),
  ).rejects.toThrow(NotFoundError);
  const foreign = await f.draft();
  const foreignRecord = f.db.records.find((row) => row.id === foreign.id);
  if (!foreignRecord) throw new Error("Нет чужого черновика");
  if (timur.kind !== "student") throw new Error("Нужен студент");
  foreignRecord.studentId = timur.studentId;
  await expect(f.submit.execute(anna, foreign)).rejects.toThrow(NotFoundError);
  const record = f.db.records.find((row) => row.id === next.id);
  if (!record) throw new Error("Нет черновика");
  const approval = {
    id: "approval",
    draftId: record.id,
    updatedAt: record.updatedAt,
    payload: record.payload,
  };
  await expect(f.approved.execute(anna, approval, "192.0.2.1")).rejects.toThrow(
    RateLimitedError,
  );
  await expect(
    f.approved.execute(anna, approval, "192.0.2.2"),
  ).resolves.toMatchObject({ status: "submitted" });
  const keys = [...f.limiter.attempts.keys()];
  expect(keys).toHaveLength(3);
  for (const key of keys) {
    expect(key).not.toContain("192.0.2.");
    expect(key).toMatch(/^request-submission:(pair|student):[a-f0-9]{64}$/);
  }
});

it("предохранитель демо-студента ограничивает множество разных IP", async () => {
  const f = fixture();
  for (let i = 0; i < 200; i++) {
    const reservation = await f.quota.reserve(anna, `192.0.2.${i}`);
    await reservation?.commitFailure();
  }
  await expect(f.quota.reserve(anna, "198.51.100.1")).rejects.toThrow(
    RateLimitedError,
  );
  f.clock.advance(3_600_000 - 1);
  await expect(f.quota.reserve(anna, "198.51.100.1")).rejects.toThrow(
    RateLimitedError,
  );
  f.clock.advance(1);
  await expect(f.quota.reserve(anna, "198.51.100.1")).resolves.toBeTruthy();
  await expect(f.quota.reserve(marina)).rejects.toThrow();
});

it("часовой предохранитель не снимает суточную квоту пары студент/IP", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    const reservation = await f.quota.reserve(anna, "192.0.2.1");
    await reservation?.commitFailure();
  }
  f.clock.advance(3_600_000);
  await expect(f.quota.reserve(anna, "192.0.2.1")).rejects.toThrow(
    RateLimitedError,
  );
  await expect(f.quota.reserve(anna, "192.0.2.2")).resolves.toBeTruthy();
});

it("обычный студент сохраняет прежнюю квоту 20 независимо от IP", async () => {
  const f = fixture(false);
  for (let i = 0; i < 20; i++)
    await f.submit.execute(anna, await f.draft(), "192.0.2.1");
  await expect(
    f.submit.execute(anna, await f.draft(), "192.0.2.2"),
  ).rejects.toThrow(RateLimitedError);
  expect(f.limiter.attempts.size).toBe(0);
});

it("отказ перехода освобождает резерв демо-квоты", async () => {
  const f = fixture();
  const next = await f.draft();
  f.db.failNotification = true;
  await expect(f.submit.execute(anna, next)).rejects.toThrow("Тестовый отказ");
  expect(f.limiter.attempts.size).toBe(0);
  expect(f.db.records[0]?.status).toBe("draft");
});
