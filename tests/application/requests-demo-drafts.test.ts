import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { RequestDraftLimit } from "@/application/requests/draft-limit";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { RateLimitedError } from "@/application/shared/errors";
import { assistantFixture, collect, toolRuntime } from "../fakes/assistant";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, FakeRateLimiter, timur } from "../fakes/identity";
import { FakeRequests } from "../fakes/requests";

const input = {
  typeCode: "enrollment",
  payload: { destination: "Учебный центр" },
};
const tokens = {
  hash: (value: string) => createHash("sha256").update(value).digest("hex"),
};

function fixture(demo = true) {
  const db = new FakeRequests();
  if (demo) db.demoUserIds.add(anna.userId);
  const clock = new FakeClock("2026-11-06T09:00:00Z");
  const ids = new SequentialIdGenerator();
  const limiter = new FakeRateLimiter(clock);
  const quota = new RequestDraftLimit(db, limiter, tokens, () => "192.0.2.1");
  return {
    db,
    clock,
    limiter,
    create: new CreateRequestDraft(db, clock, ids, quota),
    bootstrap: new CreateRequestDraft(db, clock, ids),
  };
}

it("демо: новый черновик вытесняет самый старый без seed_key, сохраняя сид и чужие данные", async () => {
  const f = fixture();
  const foreign = await f.bootstrap.execute(timur, input);
  const seeded = await f.bootstrap.execute(anna, input);
  f.db.seededDraftIds.add(seeded.id);
  const unseeded: { id: string }[] = [];
  for (let i = 0; i < 19; i++) {
    f.clock.advance(1);
    unseeded.push(await f.bootstrap.execute(anna, input));
  }
  const next = await f.create.execute(anna, input);
  expect(f.db.records.some((row) => row.id === unseeded[0]?.id)).toBe(false);
  expect(f.db.records.some((row) => row.id === seeded.id)).toBe(true);
  expect(f.db.records.some((row) => row.id === foreign.id)).toBe(true);
  expect(f.db.records.some((row) => row.id === next.id)).toBe(true);
  expect(
    f.db.records.filter((row) => row.studentUserId === anna.userId),
  ).toHaveLength(20);
});

it("двадцать засеянных черновиков не вытесняются и не расходуют частотную квоту", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    const draft = await f.bootstrap.execute(anna, input);
    f.db.seededDraftIds.add(draft.id);
  }
  const before = structuredClone(f.db.records);
  await expect(f.create.execute(anna, input)).rejects.toThrow(RateLimitedError);
  expect(f.db.records).toEqual(before);
  expect(f.limiter.attempts.size).toBe(0);
});

it("обычный студент сохраняет предел 20 без вытеснения и IP-счётчика", async () => {
  const f = fixture(false);
  for (let i = 0; i < 20; i++) await f.create.execute(anna, input);
  const before = structuredClone(f.db.records);
  await expect(f.create.execute(anna, input, "192.0.2.2")).rejects.toThrow(
    RateLimitedError,
  );
  expect(f.db.records).toEqual(before);
  expect(f.limiter.attempts.size).toBe(0);
});

it("создания ограничены на студент/IP: другой посетитель не блокируется, IP хранится только под хэшем", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.create.execute(anna, input);
  await expect(f.create.execute(anna, input)).rejects.toThrow(RateLimitedError);
  await expect(
    f.create.execute(anna, input, "192.0.2.2"),
  ).resolves.toHaveProperty("id");
  const keys = [...f.limiter.attempts.keys()];
  expect(keys).toHaveLength(2);
  for (const key of keys) {
    expect(key).toMatch(/^request-draft:pair:[a-f0-9]{64}$/);
    expect(key).not.toContain("192.0.2.");
  }
  f.clock.advance(15 * 60 * 1000 - 1);
  await expect(f.create.execute(anna, input)).rejects.toThrow(RateLimitedError);
  f.clock.advance(1);
  await expect(f.create.execute(anna, input)).resolves.toHaveProperty("id");
});

it("ошибка создания откатывает вытеснение и освобождает резерв", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.bootstrap.execute(anna, input);
  const before = structuredClone(f.db.records);
  vi.spyOn(f.db, "createDraft").mockRejectedValueOnce(
    new Error("Тестовый отказ записи"),
  );
  await expect(f.create.execute(anna, input)).rejects.toThrow(
    "Тестовый отказ записи",
  );
  expect(f.db.records).toEqual(before);
  expect(f.limiter.attempts.size).toBe(0);
});

it("заполнение очереди конкурентным создателем повторяет tx без инверсии блокировок", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.bootstrap.execute(anna, input);
  const oldest = f.db.records[0]?.id;
  vi.spyOn(f.db, "findOldestUnseededDraftForStudent").mockResolvedValueOnce(
    null,
  );
  await expect(f.create.execute(anna, input)).resolves.toHaveProperty("id");
  expect(f.db.records).toHaveLength(20);
  expect(f.db.records.some((row) => row.id === oldest)).toBe(false);
  expect([...f.limiter.attempts.values()].flat()).toHaveLength(1);
});

it("draft_request ассистента делит IP-квоту формы и вытесняет старый черновик другого посетителя", async () => {
  const failures: unknown[] = [];
  const f = assistantFixture(
    toolRuntime(async ({ tools }) => {
      try {
        return await tools.execute("draft_request", {
          type: "enrollment",
          fields: input.payload,
        });
      } catch (error) {
        failures.push(error);
        throw error;
      }
    }),
  );
  f.db.demoUserIds.add(f.actor.userId);
  const limiter = new FakeRateLimiter(f.clock);
  f.deps.requests.createDraft = new CreateRequestDraft(
    f.db,
    f.clock,
    f.ids,
    new RequestDraftLimit(f.db, limiter, tokens, () => "192.0.2.1"),
  );
  for (let i = 0; i < 20; i++)
    await f.deps.requests.createDraft.execute(f.actor, input);
  const question = "Нужна справка для организации «Учебный центр».";
  const before = structuredClone(f.db.records);
  const blockedEvents = await collect(
    await f.ask.execute(
      f.actor,
      {
        action: "ask",
        threadId: f.ids.next(),
        question,
      },
      { ip: "192.0.2.1" },
    ),
  );
  expect(failures).toEqual([expect.any(RateLimitedError)]);
  expect(blockedEvents.some((event) => event.type === "draft")).toBe(false);
  expect(f.db.records).toEqual(before);
  const oldest = f.db.records[0]?.id;
  const events = await collect(
    await f.ask.execute(
      f.actor,
      {
        action: "ask",
        threadId: f.ids.next(),
        question,
      },
      { ip: "192.0.2.2" },
    ),
  );
  expect(events.some((event) => event.type === "draft")).toBe(true);
  expect(f.db.records).toHaveLength(20);
  expect(f.db.records.some((row) => row.id === oldest)).toBe(false);
});
