import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeInput } from "@/application/assistant/ports";
import { createToolSchemas } from "@/application/assistant/schemas";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  AiSdkAssistantRuntime,
  configuredModels,
  createAssistantRepair,
  sdkTools,
} from "@/infrastructure/ai/ai-sdk-runtime";
import { assistantMockModel } from "@/infrastructure/ai/mock-model";

type Generated = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
const usage: Generated["usage"] = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
function generated(content: Generated["content"]): Generated {
  return {
    content,
    usage,
    warnings: [],
    finishReason: { unified: "tool-calls", raw: undefined },
  };
}
const call = (name: string, input: unknown) => ({
  type: "tool-call" as const,
  toolCallId: "call-1",
  toolName: name,
  input: JSON.stringify(input),
});
function input(): RuntimeInput {
  return {
    question: "Где следующая пара?",
    history: [],
    context: JSON.stringify({
      now: "2026-11-04",
      schedule: {},
      requestTypes: [],
    }),
    tools: {
      schemas: createToolSchemas([
        {
          code: "enrollment",
          title: "Справка",
          fields: [],
          description: "",
          slaWorkDays: 3,
          delivery: "pdf",
          isCertificate: true,
        },
      ]),
      execute: vi.fn(async () => ({ next: null })),
    },
  };
}
async function drain(stream: AsyncIterable<unknown>) {
  for await (const _ of stream) {
    /* Consume the stream to execute every SDK step. */
  }
}
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("NETWORK_DISABLED");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("AI SDK: production-рантайм без сети", () => {
  it.each([
    [new NotFoundError(), "NOT_FOUND"],
    [new ValidationError({ payload: ["PRIVATE_SQL_DETAIL"] }), "VALIDATION"],
    [new RateLimitedError(), "RATE_LIMITED"],
    [new ConflictError(), "CONFLICT"],
    [new ForbiddenError(), "FORBIDDEN"],
    [new Error("PRIVATE_SQL_DETAIL: select * from students"), "INTERNAL"],
  ])(
    "исключение тула преобразуется в безопасный результат: %s → %s",
    async (error, code) => {
      const request = input();
      request.tools.execute = vi.fn(async () => {
        throw error;
      });
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const model = new MockLanguageModelV4({
        doGenerate: [
          generated([call("find_schedule", { view: "next" })]),
          {
            ...generated([{ type: "text", text: "Действие пока недоступно." }]),
            finishReason: { unified: "stop", raw: undefined },
          },
        ],
      });
      const result = await generateText({
        model,
        prompt: request.question,
        tools: sdkTools(request, logger),
        stopWhen: stepCountIs(2),
      });
      expect(model.doGenerateCalls).toHaveLength(2);
      const forwarded = JSON.stringify(model.doGenerateCalls[1]?.prompt);
      expect(forwarded).toContain(String(code));
      expect(forwarded).not.toContain("PRIVATE_SQL_DETAIL");
      expect(forwarded).not.toContain("select *");
      expect(forwarded).not.toContain("error-text");
      expect(result.text).toBe("Действие пока недоступно.");
      if (code === "INTERNAL")
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
          "assistant_tool_failed",
          { code: "ASSISTANT_TOOL_INTERNAL" },
        );
      else expect(logger.error).not.toHaveBeenCalled();
    },
  );
  it("mock-модель выбирает тул и выдаёт поток текста", async () => {
    const request = input();
    const runtime = new AiSdkAssistantRuntime((request) => ({
      primary: assistantMockModel(request),
    }));
    const events = [];
    for await (const event of runtime.stream(request)) events.push(event);
    expect(request.tools.execute).toHaveBeenCalledWith("find_schedule", {
      view: "next",
    });
    expect(
      events.filter((event) => event.type === "text").length,
    ).toBeGreaterThan(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("настоящий needsApproval блокирует execute submit_request", async () => {
    const request = input();
    const model = new MockLanguageModelV4({
      doGenerate: generated([
        call("submit_request", {
          draftId: "00000000-0000-7000-8000-000000000001",
        }),
      ]),
    });
    const result = await generateText({
      model,
      tools: sdkTools(request),
      prompt: "Отправь без вопросов",
    });
    expect(
      result.content.some((part) => part.type === "tool-approval-request"),
    ).toBe(true);
    expect(request.tools.execute).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "repair делает только один повтор и исполняет только валидный, valid=%s",
    async (valid) => {
      const request = input();
      const repairModel = new MockLanguageModelV4({
        doGenerate: generated([
          call(
            "find_schedule",
            valid ? { view: "next" } : { view: "other", studentId: "other" },
          ),
        ]),
      });
      const tools = sdkTools(request);
      const repair = createAssistantRepair(
        repairModel,
        request,
        tools,
        AbortSignal.timeout(1000),
      );
      const invalidModel = new MockLanguageModelV4({
        doGenerate: generated([call("find_schedule", { view: "bad" })]),
      });
      const result = await generateText({
        model: invalidModel,
        tools,
        prompt: request.question,
        repairToolCall: repair,
      });
      expect(repairModel.doGenerateCalls).toHaveLength(1);
      if (valid)
        expect(request.tools.execute).toHaveBeenCalledWith("find_schedule", {
          view: "next",
        });
      else {
        expect(request.tools.execute).not.toHaveBeenCalled();
        expect(result.toolCalls[0]).toMatchObject({ invalid: true });
      }
      await generateText({
        model: invalidModel,
        tools,
        prompt: request.question,
        repairToolCall: repair,
      });
      expect(repairModel.doGenerateCalls).toHaveLength(1);
      const prompt = JSON.stringify(repairModel.doGenerateCalls[0]?.prompt);
      expect(prompt).toContain("Ошибка валидации");
    },
  );
  it("ошибка основной модели переключает на запасную без запасного транспорта", async () => {
    const request = input();
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("MODEL_DOWN");
      },
    });
    const factory = vi.fn(() => ({
      primary,
      fallback: assistantMockModel(request),
    }));
    await drain(new AiSdkAssistantRuntime(factory).stream(request));
    expect(primary.doStreamCalls).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(request.tools.execute).toHaveBeenCalledWith("find_schedule", {
      view: "next",
    });
  });
  it("запасной транспорт используется только при недоступности провайдера", async () => {
    const request = input();
    const down = new MockLanguageModelV4({
      doStream: async () => {
        throw new TypeError("PROVIDER_DOWN");
      },
    });
    const factory = vi.fn((_input: RuntimeInput, compatible: boolean) =>
      compatible
        ? { primary: assistantMockModel(request) }
        : { primary: down, fallback: down },
    );
    await drain(new AiSdkAssistantRuntime(factory).stream(request));
    expect(factory.mock.calls.map((args) => args[1])).toEqual([false, true]);
  });
  it("повтор модели использует кэш тулов внутри обращения", async () => {
    const request = input();
    let step = 0;
    const first = assistantMockModel(request);
    const primary = new MockLanguageModelV4({
      doStream: (options) => {
        if (step++ === 0) return first.doStream(options);
        throw new Error("MODEL_DOWN_AFTER_TOOL");
      },
    });
    await drain(
      new AiSdkAssistantRuntime(() => ({
        primary,
        fallback: assistantMockModel(request),
      })).stream(request),
    );
    expect(request.tools.execute).toHaveBeenCalledTimes(1);
  });
  it("таймаут основной модели не подвешивает резервную", async () => {
    const request = input();
    const down = new MockLanguageModelV4({
      doStream: (options) =>
        new Promise((_, reject) => {
          options.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("TIMEOUT")),
            { once: true },
          );
        }),
    });
    await drain(
      new AiSdkAssistantRuntime(
        () => ({ primary: down, fallback: assistantMockModel(request) }),
        30,
      ).stream(request),
    );
    expect(down.doStreamCalls).toHaveLength(1);
  });
  it("все сбои дают ошибку для честного резервного ответа, а не текст исключения", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("PRIVATE_PROVIDER_DETAIL");
      },
    });
    await expect(
      drain(
        new AiSdkAssistantRuntime(() => ({
          primary: model,
          fallback: model,
        })).stream(input()),
      ),
    ).rejects.toThrow("ASSISTANT_UNAVAILABLE");
  });
  it("D-26 выбирает mock без чтения ключа", () => {
    vi.stubEnv("ASSISTANT_RUNTIME", "mock");
    vi.stubEnv("OLLAMA_API_KEY", "");
    expect(configuredModels(input(), false).primary).toBeInstanceOf(
      MockLanguageModelV4,
    );
  });
});
