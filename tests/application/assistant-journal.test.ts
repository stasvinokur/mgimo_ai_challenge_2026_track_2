import { describe, expect, it, vi } from "vitest";
import { GetMyAssistantJournal } from "@/application/assistant/get-my-journal";
import { GetRegulation } from "@/application/regulations/use-cases";
import { ForbiddenError } from "@/application/shared/errors";
import {
  assistantFixture,
  collect,
  FakeAssistantJournal,
  threadId,
} from "../fakes/assistant";
import { FakeClock } from "../fakes/clock";
import { anna, FakeTokens, marina, timur } from "../fakes/identity";
import { FakeRegulations } from "../fakes/regulations";

function fixture() {
  const clock = new FakeClock("2026-11-05T09:00:00.000Z");
  const journal = new FakeAssistantJournal();
  const regulations = new FakeRegulations();
  const get = new GetRegulation(regulations);
  return {
    clock,
    journal,
    regulations,
    get,
    query: new GetMyAssistantJournal(journal, get, clock, new FakeTokens()),
  };
}

describe("Мой журнал ассистента", () => {
  it("демо-аккаунт читает только текущую сессию, без токена или с чужим токеном журнал пуст", async () => {
    const f = fixture();
    const tokens = new FakeTokens();
    f.journal.demoUsers.add(anna.userId);
    f.journal.sessions.set(tokens.hash("session-a"), {
      userId: anna.userId,
      sessionId: "session-a-id",
    });
    f.journal.sessions.set(tokens.hash("session-b"), {
      userId: anna.userId,
      sessionId: "session-b-id",
    });
    f.journal.sessions.set(tokens.hash("foreign-session"), {
      userId: timur.userId,
      sessionId: "foreign-session-id",
    });
    for (const [sessionId, question] of [
      ["session-a-id", "Первый посетитель"],
      ["session-b-id", "Второй посетитель"],
      [null, "Запись до миграции"],
    ] as const)
      f.journal.records.push({
        userId: anna.userId,
        sessionId,
        at: f.clock.now().toISOString(),
        question,
        sources: [],
        outcome: "answered",
      });
    expect(
      (await f.query.execute(anna, "session-a")).map((entry) => entry.question),
    ).toEqual(["Первый посетитель"]);
    expect(
      (await f.query.execute(anna, "session-b")).map((entry) => entry.question),
    ).toEqual(["Второй посетитель"]);
    expect(await f.query.execute(anna)).toEqual([]);
    expect(await f.query.execute(anna, "foreign-session")).toEqual([]);
    expect(await f.query.execute(anna, "revoked-session")).toEqual([]);
    f.journal.demoUsers.delete(anna.userId);
    expect(await f.query.execute(anna, "session-b")).toHaveLength(3);
  });

  it("ассистент привязывает вопрос и неудачное подтверждение к хэшу серверной сессии", async () => {
    const f = assistantFixture();
    const sessionToken = "server-session-token";
    vi.spyOn(f.deps.tokens, "hash").mockReturnValue("a".repeat(64));
    await collect(
      await f.ask.execute(
        f.actor,
        {
          action: "ask",
          threadId,
          question: "Покажи оценки Тимура",
        },
        { ip: "192.0.2.1" },
        sessionToken,
      ),
    );
    const entry = f.journal.entries[0];
    expect(entry?.sessionTokenHash).toBe(f.deps.tokens.hash(sessionToken));
    expect(JSON.stringify(entry)).not.toContain(sessionToken);
    await expect(
      f.ask.execute(
        f.actor,
        {
          action: "approve",
          threadId,
          approvalId: "00000000-0000-7000-8000-000000000098",
          approved: true,
        },
        { ip: "192.0.2.1" },
        sessionToken,
      ),
    ).rejects.toThrow();
    expect(f.journal.entries[1]).toMatchObject({
      sessionTokenHash: f.deps.tokens.hash(sessionToken),
      outcome: "failed",
    });
  });

  it("читает вопрос и отказ, записанные реальным use case ассистента на fakes", async () => {
    const f = assistantFixture();
    const question = "Нужна справка для работодателя";
    const events = await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
    const card = events.find((event) => event.type === "draft");
    if (card?.type !== "draft") throw new Error("Нет черновика");
    f.clock.advance(1000);
    await collect(
      await f.ask.execute(f.actor, {
        action: "approve",
        threadId,
        approvalId: card.draft.approvalId,
        approved: false,
      }),
    );
    const entries = await new GetMyAssistantJournal(
      f.journal,
      f.deps.regulations.get,
      f.clock,
      f.deps.tokens,
    ).execute(f.actor);
    expect(
      entries.map((entry) => [
        entry.question,
        entry.studentDecision?.code ?? entry.assistantAction,
      ]),
    ).toEqual([
      ["decline_submission", "draftRetained"],
      [question, "drafted"],
    ]);
    expect(entries[1]?.sources).toEqual([
      {
        href: "/regulations/certificates#p-3-2",
        label: "Справки и заявления · § 3.2",
      },
    ]);
  });
  it("читает только владельца с включённой границей 14 суток, новые сверху", async () => {
    const f = fixture();
    for (const [userId, at, question] of [
      [anna.userId, "2026-10-22T09:00:00.000Z", "На границе"],
      [timur.userId, "2026-11-05T08:00:00.000Z", "Чужой вопрос"],
      [anna.userId, "2026-10-22T08:59:59.999Z", "Старая запись"],
      [anna.userId, "2026-11-05T09:00:00.000Z", "Новый вопрос"],
    ]) {
      if (!userId || !at || !question) throw new Error("Нет данных");
      f.journal.records.push({
        userId,
        at,
        question,
        sources: [],
        outcome: "answered",
      });
    }
    expect(
      (await f.query.execute(anna)).map((entry) => entry.question),
    ).toEqual(["Новый вопрос", "На границе"]);
    expect(f.journal.reads).toEqual([
      {
        userId: anna.userId,
        since: new Date("2026-10-22T09:00:00.000Z"),
        limit: 200,
      },
    ]);
    expect(
      (await f.query.execute(timur)).map((entry) => entry.question),
    ).toEqual(["Чужой вопрос"]);
  });

  it("лимит 200 задан в application и ограничивает чтение", async () => {
    const f = fixture();
    f.journal.records = Array.from({ length: 201 }, (_, i) => ({
      userId: anna.userId,
      at: new Date(f.clock.now().getTime() - i).toISOString(),
      question: `Вопрос ${i}`,
      sources: [],
      outcome: "answered",
    }));
    const result = await f.query.execute(anna);
    expect(result).toHaveLength(200);
    expect(result[0]?.question).toBe("Вопрос 0");
    expect(result.at(-1)?.question).toBe("Вопрос 199");
  });

  it("отказывает сотруднику до чтения журнала и положений", async () => {
    const f = fixture();
    await expect(f.query.execute(marina)).rejects.toThrow(ForbiddenError);
    expect(f.journal.reads).toEqual([]);
    expect(f.regulations.calls).toEqual([]);
  });

  it.each([
    ["answered", "Вопрос", "answered", null, "question", null],
    ["drafted", "Справка", "drafted", null, "question", null],
    ["refused", "Чужие данные", "refusedAction", null, "question", null],
    ["fallback", "Вопрос", "fallbackMode", null, "question", null],
    [
      "submitted",
      "confirm_submission",
      "submitted",
      { code: "requestSubmitted", href: "/requests" },
      "action",
      "confirm",
    ],
    [
      "declined",
      "decline_submission",
      "declined",
      { code: "draftRetained" },
      "action",
      "decline",
    ],
    ["drafted", "Не отправлять", "drafted", null, "question", null],
    ["failed", "Вопрос", "failed", null, "question", null],
    ["failed", "Не отправлять", "failed", null, "question", null],
    [
      "failed",
      "confirm_submission",
      "failed",
      { code: "submissionFailed", href: "/requests" },
      "action",
      "confirm",
    ],
    ["failed", "decline_submission", "failed", null, "action", "decline"],
    [
      "failed",
      "Подтвердить отправку",
      "failed",
      { code: "submissionFailed", href: "/requests" },
      "action",
      "confirm",
    ],
    [
      "submitted",
      "Подтвердить отправку",
      "submitted",
      { code: "requestSubmitted", href: "/requests" },
      "action",
      "confirm",
    ],
    [
      "declined",
      "Не отправлять",
      "declined",
      { code: "draftRetained" },
      "action",
      "decline",
    ],
    ["unknown", "Вопрос", "unknownOutcome", null, "question", null],
  ])(
    "сопоставляет исход %s и вопрос %s",
    async (outcome, question, assistantAction, studentDecision, questionLabel, questionCode) => {
      const f = fixture();
      f.journal.records.push({
        userId: anna.userId,
        at: f.clock.now().toISOString(),
        question,
        sources: [],
        outcome,
      });
      expect(await f.query.execute(anna)).toEqual([
        {
          at: f.clock.now().toISOString(),
          question,
          questionLabel,
          questionCode,
          sources: [],
          assistantAction,
          studentDecision,
        },
      ]);
    },
  );

  it("берёт подпись из положения, убирает дубли и непроверенные ссылки; DTO не содержит сервисных данных", async () => {
    const f = fixture();
    const question = '<script>alert("текст")</script> **вопрос**';
    const record = {
      userId: anna.userId,
      at: f.clock.now().toISOString(),
      question,
      sources: [
        "/regulations/scholarship#p-2",
        "/regulations/scholarship#p-2",
        "/regulations/scholarship#p-99",
        "/regulations/removed#p-1",
        "https://foreign.example/regulations/scholarship#p-2",
        "javascript:alert(1)",
      ],
      outcome: "answered",
      tool_calls: [{ secret: "SERVICE_DATA_SENTINEL" }],
      systemPrompt: "SYSTEM_PROMPT_SENTINEL",
      id: "LOG_ID_SENTINEL",
    };
    f.journal.records.push(record);
    expect(await f.query.execute(anna)).toEqual([
      {
        at: record.at,
        question,
        questionLabel: "question",
        questionCode: null,
        sources: [
          { href: "/regulations/scholarship#p-2", label: "Стипендии · § 2" },
        ],
        assistantAction: "answered",
        studentDecision: null,
      },
    ]);
    expect(f.regulations.calls).toEqual(["scholarship", "removed"]);
  });

  it("не склеивает перемежающиеся черновики и решения, пустой журнал не читает положения", async () => {
    const f = fixture();
    expect(await f.query.execute(anna)).toEqual([]);
    expect(f.regulations.calls).toEqual([]);
    for (const [outcome, question] of [
      ["drafted", "Первый"],
      ["drafted", "Второй"],
      ["submitted", "confirm_submission"],
    ]) {
      if (!outcome || !question) throw new Error("Нет данных");
      f.journal.records.push({
        userId: anna.userId,
        at: f.clock.now().toISOString(),
        question,
        outcome,
        sources: [],
      });
    }
    expect(await f.query.execute(anna)).toHaveLength(3);
  });

  it("ошибку БД положения не прячет за пустыми источниками", async () => {
    const f = fixture();
    f.journal.records.push({
      userId: anna.userId,
      at: f.clock.now().toISOString(),
      question: "Вопрос",
      sources: ["/regulations/scholarship#p-2"],
      outcome: "answered",
    });
    vi.spyOn(f.get, "execute").mockRejectedValue(
      new Error("REGULATION_UNAVAILABLE"),
    );
    await expect(f.query.execute(anna)).rejects.toThrow(
      "REGULATION_UNAVAILABLE",
    );
  });
});
