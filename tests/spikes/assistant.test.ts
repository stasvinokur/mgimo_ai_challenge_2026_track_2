import { spawnSync } from "node:child_process";
import { generateText, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtures } from "../../scripts/spikes/assistant/fixtures.js";
import {
  createRepair,
  percentile,
  validCalls,
} from "../../scripts/spikes/assistant/runtime.js";
import { createTools, schemas } from "../../scripts/spikes/assistant/tools.js";

type Response = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

function response(content: Response["content"]): Response {
  return {
    content,
    finishReason: {
      unified: content.some((part) => part.type === "tool-call")
        ? "tool-calls"
        : "stop",
      raw: undefined,
    },
    usage: {
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  };
}

const submitCall = {
  type: "tool-call" as const,
  toolCallId: "call-submit-1",
  toolName: "submit_request",
  input: JSON.stringify({ draftId: "draft-demo-1" }),
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Сеть запрещена в тестах спайка");
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Подтверждение отправки заявки в AI SDK 7", () => {
  it("не выполняет тул до одобрения и возвращает запрос подтверждения", async () => {
    const submit = vi.fn();
    const model = new MockLanguageModelV4({
      doGenerate: response([submitCall]),
    });
    const result = await generateText({
      model,
      tools: createTools(submit),
      prompt: "Отправь заявку",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-approval-request",
          toolCall: expect.objectContaining({
            toolName: "submit_request",
            input: { draftId: "draft-demo-1" },
          }),
        }),
      ]),
    );
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it.each([true, false])(
    "при approved=%s выполняет решение человека",
    async (approved) => {
      const submit = vi.fn();
      const tools = createTools(submit);
      const model = new MockLanguageModelV4({
        doGenerate: [
          response([submitCall]),
          response([
            {
              type: "text",
              text: approved ? "Отправлено" : "Отправка отменена",
            },
          ]),
        ],
      });
      const first = await generateText({
        model,
        tools,
        prompt: "Отправь заявку",
      });
      expect(submit).not.toHaveBeenCalled();
      const approval = first.content.find(
        (part) => part.type === "tool-approval-request",
      );
      if (approval?.type !== "tool-approval-request")
        throw new Error("SDK не запросил подтверждение");
      const messages: ModelMessage[] = [
        { role: "user", content: "Отправь заявку" },
        ...first.response.messages,
        {
          role: "tool",
          content: [
            {
              type: "tool-approval-response",
              approvalId: approval.approvalId,
              approved,
              reason: approved ? "Студент подтвердил" : "Студент отказался",
            },
          ],
        },
      ];
      await generateText({ model, tools, messages });
      expect(submit).toHaveBeenCalledTimes(approved ? 1 : 0);
      const secondPrompt = model.doGenerateCalls[1]?.prompt;
      expect(JSON.stringify(secondPrompt)).toContain(
        approved ? "submitted" : "execution-denied",
      );
    },
  );
});

describe("Проверка измерительного стенда без сети", () => {
  it("CLI без ENV_FILE и ключа завершается понятной ошибкой до сети", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/spikes/assistant/run.js"],
      {
        env: { ...process.env, ENV_FILE: "", OLLAMA_API_KEY: "" },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Не задан OLLAMA_API_KEY");
    expect(result.stderr).not.toContain("Bearer");
  });

  it("все ожидаемые аргументы фикстуры валидны; чужие идентификаторы отвергаются", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    for (const fixture of fixtures) {
      if (fixture.tool)
        expect(
          validCalls([{ toolName: fixture.tool, input: fixture.input }]),
        ).toBe(true);
    }
    expect(
      schemas.explain_grade.safeParse({
        course: "all",
        studentId: "timur-demo",
      }).success,
    ).toBe(false);
    expect(
      schemas.draft_request.safeParse({ type: "справка об учебе", fields: {} })
        .success,
    ).toBe(false);
  });

  it("repair делает один повтор с ошибкой, без подстановки ожидаемого ответа", async () => {
    const repairedCall = {
      type: "tool-call" as const,
      toolCallId: "repair-1",
      toolName: "draft_request",
      input: JSON.stringify({
        type: "enrollment_certificate",
        fields: { recipient: "ООО Альта" },
      }),
    };
    const model = new MockLanguageModelV4({
      doGenerate: response([repairedCall]),
    });
    const tools = createTools();
    const events: unknown[] = [];
    const fixture = fixtures[0];
    if (!fixture) throw new Error("Нет фикстуры");
    const result = await generateText({
      model: new MockLanguageModelV4({
        doGenerate: response([
          {
            ...repairedCall,
            input: JSON.stringify({ type: "справка об учебе", fields: {} }),
          },
        ]),
      }),
      tools,
      prompt: fixture.prompt,
      repairToolCall: createRepair(
        model,
        fixture,
        tools,
        events,
        AbortSignal.timeout(5000),
      ),
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "Ошибка валидации",
    );
    expect(events).toHaveLength(1);
    expect(result.toolCalls[0]?.input).toEqual({
      type: "enrollment_certificate",
      fields: { recipient: "ООО Альта" },
    });
  });

  it("повторно не чинит невалидный repair", async () => {
    const invalid = {
      ...submitCall,
      input: JSON.stringify({ draftId: "чужой-черновик" }),
    };
    const model = new MockLanguageModelV4({ doGenerate: response([invalid]) });
    const tools = createTools();
    const events: unknown[] = [];
    const fixture = fixtures.find((item) => item.id === "submit");
    if (!fixture) throw new Error("Нет фикстуры");
    const result = await generateText({
      model: new MockLanguageModelV4({ doGenerate: response([invalid]) }),
      tools,
      prompt: fixture.prompt,
      repairToolCall: createRepair(
        model,
        fixture,
        tools,
        events,
        AbortSignal.timeout(5000),
      ),
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ invalid: true });
  });

  it("p50/p95 используют ближайший ранг", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });
});
