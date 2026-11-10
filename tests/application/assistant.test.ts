import { describe, expect, it, vi } from "vitest";
import { AssistantBusyError } from "@/application/assistant/errors";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  assistantFixture,
  collect,
  threadId,
  toolRuntime,
} from "../fakes/assistant";
import { marina, timur } from "../fakes/identity";

const question = "Мне нужна бумага для работодателя";
const askInput = { action: "ask", threadId, question };
describe("Ассистент: свои данные, тулы и подтверждение", () => {
  it("после отказа исправляет тот же черновик и отправляет только новое подтверждение", async () => {
    const f = assistantFixture();
    const initial = await collect(await f.ask.execute(f.actor, askInput));
    const card1 = initial.find((event) => event.type === "draft");
    if (card1?.type !== "draft") throw new Error("Нет первой карточки");
    const declined = await collect(
      await f.ask.execute(f.actor, {
        action: "approve",
        threadId,
        approvalId: card1.draft.approvalId,
        approved: false,
      }),
    );
    expect(declined).toContainEqual({
      type: "declined",
      id: card1.draft.id,
      approvalId: card1.draft.approvalId,
    });
    expect(f.db.records[0]?.status).toBe("draft");
    const updated = await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Исправь справку: получатель — Учебный центр «Орион»",
      }),
    );
    const card2 = updated.find((event) => event.type === "draft");
    if (card2?.type !== "draft") throw new Error("Нет новой карточки");
    expect(f.db.records).toHaveLength(1);
    expect(card2.draft.id).toBe(card1.draft.id);
    expect(card2.draft.approvalId).toBeTruthy();
    expect(card2.draft.approvalId).not.toBe(card1.draft.approvalId);
    expect(f.db.records[0]?.payload.destination).toBe("Учебный центр «Орион»");
    await expect(
      f.ask.execute(f.actor, {
        action: "approve",
        threadId,
        approvalId: card1.draft.approvalId,
        approved: true,
      }),
    ).rejects.toThrow(NotFoundError);
    const submitted = await collect(
      await f.ask.execute(f.actor, {
        action: "approve",
        threadId,
        approvalId: card2.draft.approvalId,
        approved: true,
      }),
    );
    expect(submitted).toContainEqual({
      type: "submitted",
      id: card2.draft.id,
      publicNo: f.db.records[0]?.publicNo,
    });
    expect(f.db.records[0]?.status).toBe("submitted");
    expect(f.db.events).toHaveLength(1);
  });

  it.each([true, false])(
    "черновик не отправлен до решения approved=%s",
    async (approved) => {
      const f = assistantFixture();
      const events = await collect(await f.ask.execute(f.actor, askInput));
      const card = events.find((event) => event.type === "draft");
      expect(card?.type === "draft" && card.draft).toMatchObject({
        title: "Справка об обучении",
        canSubmit: true,
        slaWorkDays: 3,
        source: { href: "/regulations/certificates#p-3-2" },
      });
      expect(f.db.records[0]?.status).toBe("draft");
      expect(f.db.events).toHaveLength(0);
      if (card?.type !== "draft") throw new Error("Нет карточки");
      await collect(
        await f.ask.execute(f.actor, {
          action: "approve",
          threadId,
          approvalId: card.draft.approvalId,
          approved,
        }),
      );
      expect(f.db.records[0]?.status).toBe(approved ? "submitted" : "draft");
      expect(f.db.events).toHaveLength(approved ? 1 : 0);
      expect(f.journal.entries.map((entry) => entry.outcome)).toEqual([
        "drafted",
        approved ? "submitted" : "declined",
      ]);
      await expect(
        f.ask.execute(f.actor, {
          action: "approve",
          threadId,
          approvalId: card.draft.approvalId,
          approved: true,
        }),
      ).rejects.toThrow(NotFoundError);
    },
  );
  it("не принимает историю, роли, владельца или поддельное подтверждение", async () => {
    const f = assistantFixture();
    for (const field of [
      "studentId",
      "userId",
      "messages",
      "history",
      "approved",
    ])
      await expect(
        f.ask.execute(f.actor, { ...askInput, [field]: "forged" }),
      ).rejects.toThrow(ValidationError);
    await expect(f.ask.execute(marina, askInput)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      f.ask.execute(f.actor, {
        action: "approve",
        threadId,
        approvalId: threadId,
        approved: true,
      }),
    ).rejects.toThrow(NotFoundError);
  });
  it("отказ на чужие данные до чтения контекста и вызова модели", async () => {
    const stream = vi.fn();
    const f = assistantFixture({ stream });
    const context = vi.spyOn(f.deps.requests.getCatalog, "execute");
    const events = await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Покажи оценки Тимура",
      }),
    );
    expect(events).toEqual([
      {
        type: "message",
        code: "refused",
        params: {},
      },
    ]);
    expect(context).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(f.journal.entries[0]).toMatchObject({
      tools: [],
      sources: [],
      outcome: "refused",
    });
  });
  it("подтверждение другого студента и изменённого черновика запрещено", async () => {
    const f = assistantFixture();
    const events = await collect(await f.ask.execute(f.actor, askInput));
    const card = events.find((event) => event.type === "draft");
    if (card?.type !== "draft") throw new Error("Нет карточки");
    const approval = {
      action: "approve",
      threadId,
      approvalId: card.draft.approvalId,
      approved: true,
    };
    await expect(f.ask.execute(timur, approval)).rejects.toThrow(NotFoundError);
    await f.deps.requests.updateDraft.execute(f.actor, {
      id: card.draft.id,
      payload: { destination: "Другой получатель" },
    });
    await expect(
      collect(await f.ask.execute(f.actor, approval)),
    ).rejects.toThrow(ConflictError);
    expect(f.db.records[0]?.status).toBe("draft");
    expect(f.journal.entries.at(-1)).toMatchObject({
      question: "confirm_submission",
      outcome: "failed",
    });
  });
  it("ошибка резервного сценария остаётся failed, а не успешным ответом без ИИ", async () => {
    const f = assistantFixture({
      async *stream() {
        yield { type: "progress" };
        throw new Error("RUNTIME_UNAVAILABLE");
      },
    });
    vi.spyOn(f.deps.regulations.search, "execute").mockRejectedValue(
      new Error("REGULATIONS_UNAVAILABLE"),
    );
    await expect(
      collect(
        await f.ask.execute(f.actor, {
          ...askInput,
          question: "Как получить академический отпуск?",
        }),
      ),
    ).rejects.toThrow("REGULATIONS_UNAVAILABLE");
    expect(f.journal.entries.at(-1)?.outcome).toBe("failed");
  });
  it("отбрасывает догадки и сохраняет дословные кавычки", async () => {
    const f = assistantFixture(
      toolRuntime(async (input) =>
        input.tools.execute("draft_request", {
          type: "enrollment",
          fields: { destination: "ООО «Альта»", country: "Франция" },
        }),
      ),
    );
    await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Справка в ООО «Альта»",
      }),
    );
    expect(f.db.records[0]?.payload).toEqual({ destination: "ООО «Альта»" });
  });
  it("даже вредоносный runtime не отправляет черновик через тул", async () => {
    const f = assistantFixture(
      toolRuntime(async (input) => {
        const draft = (await input.tools.execute("draft_request", {
          type: "enrollment",
          fields: {},
        })) as { id: string };
        await expect(
          input.tools.execute("submit_request", { draftId: draft.id }),
        ).rejects.toThrow(ForbiddenError);
      }),
    );
    await collect(await f.ask.execute(f.actor, askInput));
    expect(f.db.records[0]?.status).toBe("draft");
  });
  it("схемы запрещают владельцев и неизвестный enum, what-if считает доменом ровно 86", async () => {
    const f = assistantFixture(
      toolRuntime(async (input) => {
        expect(
          input.tools.schemas.draft_request.safeParse({
            type: "справка",
            fields: {},
          }).success,
        ).toBe(false);
        for (const schema of Object.values(input.tools.schemas))
          expect(schema.safeParse({ studentId: "other" }).success).toBe(false);
        const data = await input.tools.execute("what_if", {
          courseId: "00000000-0000-7000-8000-000000000010",
          predictions: [
            { assessmentId: "00000000-0000-7000-8000-000000000013", score: 68 },
          ],
        });
        expect(data).toMatchObject({ total: 86, grade: "отлично" });
        await expect(
          input.tools.execute("explain_grade", { courseId: threadId }),
        ).rejects.toThrow(NotFoundError);
      }),
    );
    await collect(
      await f.ask.execute(f.actor, { ...askInput, question: "Что если 68?" }),
    );
    expect(
      f.gradesDb.calls.every((call) => call.studentId === "anna-student"),
    ).toBe(true);
  });
  it.each([
    "Где следующая пара?",
    "Что изменилось?",
    "Есть ли долги?",
    "Нужна справка для работодателя",
    "несуществующеесловоъ",
  ])("честный резервный режим: %s", async (question) => {
    const f = assistantFixture({
      async *stream() {
        yield { type: "progress" };
        throw new Error("Тестовая недоступность");
      },
    });
    f.regulationDb.matches = [];
    const events = await collect(
      await f.ask.execute(f.actor, { ...askInput, question }),
    );
    expect(events).toContainEqual({ type: "mode", mode: "fallback" });
    expect(
      events.some(
        (event) => event.type === "message" && event.code === "fallbackStart",
      ),
    ).toBe(true);
    expect(f.journal.entries[0]?.outcome).toBe("fallback");
    if (question === "несуществующеесловоъ") {
      expect(
        events.some(
          (event) => event.type === "message" && event.code === "unknownAnswer",
        ),
      ).toBe(true);
      expect(f.db.records[0]).toMatchObject({
        typeCode: "question",
        payload: { question },
      });
    }
  });
  it("источники выдаются независимо от текста модели, журнал не содержит результаты", async () => {
    const f = assistantFixture(
      toolRuntime(async (input) =>
        input.tools.execute("search_regulations", { query: "стипендия" }),
      ),
    );
    const events = await collect(
      await f.ask.execute(f.actor, { ...askInput, question: "стипендия" }),
    );
    expect(events).toContainEqual({
      type: "source",
      source: expect.objectContaining({ href: "/regulations/scholarship#p-2" }),
    });
    expect(f.journal.entries[0]).toEqual({
      userId: f.actor.userId,
      question: "стипендия",
      tools: ["search_regulations"],
      sources: ["/regulations/scholarship#p-2"],
      outcome: "answered",
    });
  });
  it("резервирует максимум 20 вопросов за 10 минут, лимит отдельный для студента", async () => {
    const f = assistantFixture();
    const results: PromiseSettledResult<unknown>[] = [];
    for (let i = 0; i < 23; i++) {
      results.push(
        ...(await Promise.allSettled([
          f.ask
            .execute(f.actor, {
              ...askInput,
              threadId: `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`,
              question: "Покажи оценки Тимура",
            })
            .then(collect),
        ])),
      );
    }
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(20);
    expect(
      results
        .filter((result) => result.status === "rejected")
        .every(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof RateLimitedError,
        ),
    ).toBe(true);
    f.clock.advance(600001);
    await expect(
      collect(
        await f.ask.execute(f.actor, {
          ...askInput,
          question: "Покажи оценки Тимура",
        }),
      ),
    ).resolves.toBeDefined();
  });
  it("IP из метаданных отделяет лимит пары; общий лимит пользователя выше", async () => {
    const f = assistantFixture();
    const hash = vi.spyOn(f.deps.tokens, "hash");
    const input = { ...askInput, question: "Покажи оценки Тимура" };
    for (let ip = 1; ip <= 30; ip++) {
      const client = { ip: `198.51.100.${ip}` };
      for (let i = 0; i < 20; i++)
        await collect(await f.ask.execute(f.actor, input, client));
      await expect(f.ask.execute(f.actor, input, client)).rejects.toThrow(
        RateLimitedError,
      );
    }
    await expect(
      f.ask.execute(f.actor, input, { ip: "198.51.100.31" }),
    ).rejects.toThrow(RateLimitedError);
    expect(hash).toHaveBeenCalledWith(`${f.actor.userId}\0${"198.51.100.1"}`);
    expect(hash).toHaveBeenCalledWith(f.actor.userId);
    await expect(
      f.ask.execute(f.actor, { ...input, ip: "198.51.100.5" }),
    ).rejects.toThrow(ValidationError);
  });
  it("разные диалоги одного пользователя одновременно выполняют оба вопроса", async () => {
    let release = () => {};
    let bothStarted = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    let active = 0;
    const stream = vi.fn(async function* () {
      active++;
      if (active === 2) bothStarted();
      await gate;
      yield { type: "text" as const, text: "Ответ" };
    });
    const f = assistantFixture({ stream });
    const first = collect(await f.ask.execute(f.actor, askInput));
    let second: ReturnType<typeof collect> | undefined;
    try {
      second = collect(
        await f.ask.execute(f.actor, {
          ...askInput,
          threadId: "00000000-0000-7000-8000-000000000100",
        }),
      );
      await started;
      expect(stream).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect(f.journal.entries).toHaveLength(2);
  });
  it("второй вопрос того же диалога получает 409 без записи вопроса; блокировка освобождается", async () => {
    const stream = vi.fn(async function* () {
      yield { type: "text" as const, text: "Ответ" };
    });
    const f = assistantFixture({ stream });
    const first = await f.ask.execute(f.actor, askInput);
    const next = {
      ...askInput,
      question: "Второй вопрос, который нельзя записывать при 409",
    };
    await expect(
      f.ask.execute(f.actor, next, { ip: "198.51.100.2" }),
    ).rejects.toThrow(AssistantBusyError);
    expect(f.journal.entries).toHaveLength(0);
    expect(stream).not.toHaveBeenCalled();
    await collect(first);
    expect(stream).toHaveBeenCalledTimes(1);
    await collect(await f.ask.execute(f.actor, next));
    expect(stream).toHaveBeenCalledTimes(2);
  });
  it("429 не пишет вопрос и не создаёт строки журнала при повторных отказах", async () => {
    const stream = vi.fn();
    const f = assistantFixture({ stream });
    vi.spyOn(f.deps.limiter, "reserve").mockResolvedValue(null);
    for (let i = 0; i < 25; i++) {
      await expect(
        f.ask.execute(f.actor, {
          ...askInput,
          question: "Отклонённый вопрос с вымышленными сведениями",
        }),
      ).rejects.toThrow(RateLimitedError);
    }
    expect(f.journal.entries).toHaveLength(0);
    expect(stream).not.toHaveBeenCalled();
  });
  it("ожидающее подтверждение сохраняется после шести новых диалогов общего аккаунта", async () => {
    const f = assistantFixture();
    const events = await collect(await f.ask.execute(f.actor, askInput));
    const card = events.find((event) => event.type === "draft");
    if (card?.type !== "draft") throw new Error("Нет карточки");
    for (let i = 0; i < 6; i++) {
      f.clock.advance(1);
      await collect(
        await f.ask.execute(f.actor, {
          ...askInput,
          threadId: `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`,
        }),
      );
    }
    const result = await collect(
      await f.ask.execute(f.actor, {
        action: "approve",
        threadId,
        approvalId: card.draft.approvalId,
        approved: true,
      }),
    );
    expect(result).toContainEqual({
      type: "submitted",
      id: card.draft.id,
      publicNo: f.db.records.find((record) => record.id === card.draft.id)
        ?.publicNo,
    });
  });
  it("повторный draft_request в диалоге обновляет тот же черновик без переданного draftId", async () => {
    const f = assistantFixture(
      toolRuntime((input) =>
        input.tools.execute("draft_request", {
          type: "enrollment",
          fields: { destination: input.question },
        }),
      ),
    );
    const first = await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Учебный центр «Альта»",
      }),
    );
    const second = await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Учебный центр «Орион»",
      }),
    );
    const card1 = first.find((event) => event.type === "draft");
    const card2 = second.find((event) => event.type === "draft");
    expect(f.db.records).toHaveLength(1);
    expect(card2?.type === "draft" && card2.draft.id).toBe(
      card1?.type === "draft" && card1.draft.id,
    );
    expect(f.db.records[0]?.payload.destination).toBe("Учебный центр «Орион»");
    expect(card2?.type === "draft" && card2.draft.approvalId).not.toBe(
      card1?.type === "draft" && card1.draft.approvalId,
    );
  });
  it("повторное «не знаю» обновляет вопрос в деканат вместо накопления черновиков", async () => {
    const f = assistantFixture(
      toolRuntime((input) =>
        input.tools.execute("search_regulations", { query: input.question }),
      ),
    );
    f.regulationDb.matches = [];
    for (const question of [
      "Неизвестное правило",
      "Неизвестное другое правило",
      "Неизвестный срок",
    ])
      await collect(await f.ask.execute(f.actor, { ...askInput, question }));
    expect(f.db.records).toHaveLength(1);
    expect(f.db.records[0]).toMatchObject({
      typeCode: "question",
      status: "draft",
      payload: { question: "Неизвестный срок" },
    });
  });
  it.each([
    ["Не знаю. ", "Передать вопрос в деканат?"],
    ["**Не знаю.**\n", "**Передать вопрос в деканат?**"],
    ["Подходящих пунктов не найдено."],
  ])(
    "предложение вопроса в деканат выводится один раз: %j",
    async (...chunks: string[]) => {
      const f = assistantFixture({
        async *stream(input) {
          await input.tools.execute("search_regulations", {
            query: input.question,
          });
          for (const text of chunks) yield { type: "text", text };
        },
      });
      f.regulationDb.matches = [];
      const events = await collect(
        await f.ask.execute(f.actor, {
          ...askInput,
          question: "Неизвестное правило",
        }),
      );
      const answer = events
        .filter((event) => event.type === "text")
        .map((event) => event.text)
        .join("")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ");
      const modelOffers =
        answer.match(/Не знаю\. Передать вопрос в деканат\?/g)?.length ?? 0;
      const codedOffers = events.filter(
        (event) => event.type === "message" && event.code === "unknownAnswer",
      );
      expect(modelOffers + codedOffers.length).toBe(1);
      expect(events.some((event) => event.type === "draft")).toBe(true);
      expect(f.db.records).toHaveLength(1);
      expect(f.db.records[0]?.typeCode).toBe("question");
    },
  );
  it("модель получает актуальные тип, заполненные поля и статус черновика после смены темы", async () => {
    const contexts: Record<string, unknown>[] = [];
    const f = assistantFixture(
      toolRuntime(async (input) => {
        contexts.push(JSON.parse(input.context));
        if (input.question === question)
          await input.tools.execute("draft_request", {
            type: "enrollment",
            fields: {},
          });
      }),
    );
    await collect(await f.ask.execute(f.actor, askInput));
    const record = f.db.records[0];
    if (!record) throw new Error("Нет черновика");
    await f.deps.requests.updateDraft.execute(f.actor, {
      id: record.id,
      payload: { destination: "ООО «Орион»", country: "" },
    });
    await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Где следующая пара?",
      }),
    );
    expect(contexts[1]?.draft).toEqual({
      id: record.id,
      type: "enrollment",
      title: "Справка об обучении",
      status: "draft",
      fields: { destination: "ООО «Орион»" },
    });
    const current = await f.deps.requests.getMyRequest.execute(f.actor, {
      id: record.id,
    });
    await f.deps.submit.execute(f.actor, {
      id: f.ids.next(),
      draftId: record.id,
      updatedAt: current.updatedAt,
      payload: current.payload,
    });
    await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Что изменилось?",
      }),
    );
    expect(contexts[2]?.draft).toMatchObject({
      id: record.id,
      status: "submitted",
      fields: { destination: "ООО «Орион»" },
    });
  });
  it("контекст черновика проверяет владельца и не передаёт чужие поля или id", async () => {
    let context = "";
    const f = assistantFixture(
      toolRuntime(async (input) => {
        context = input.context;
      }),
    );
    const foreign = await f.deps.requests.createDraft.execute(timur, {
      typeCode: "enrollment",
      payload: { destination: "Чужие вымышленные сведения" },
    });
    const lease = f.deps.conversations.acquire(f.actor.userId, threadId);
    lease.state.draftId = foreign.id;
    lease.release();
    await collect(
      await f.ask.execute(f.actor, {
        ...askInput,
        question: "Где следующая пара?",
      }),
    );
    expect(JSON.parse(context).draft).toBeNull();
    expect(context).not.toContain("Чужие вымышленные сведения");
    expect(context).not.toContain(foreign.id);
  });
});
