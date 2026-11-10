import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeInput } from "@/application/assistant/ports";
import { createToolSchemas } from "@/application/assistant/schemas";
import {
  AiSdkAssistantRuntime,
  createAssistantRepair,
  sdkTools,
} from "@/infrastructure/ai/ai-sdk-runtime";

type Stream = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type Part = Stream["stream"] extends ReadableStream<infer T> ? T : never;
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

function input(
  question: string,
  history: RuntimeInput["history"],
): RuntimeInput {
  return {
    question,
    history,
    context: JSON.stringify({
      course: "Учебная дипломатия",
      teacher: "Дарья Примерова",
      excerpt: "Период — не больше 14 дней включительно.",
    }),
    tools: {
      schemas: createToolSchemas([]),
      execute: vi.fn(async () => ({ next: null })),
    },
  };
}

function textModel(answer: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<Part>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "answer" });
          controller.enqueue({
            type: "text-delta",
            id: "answer",
            delta: answer,
          });
          controller.enqueue({ type: "text-end", id: "answer" });
          controller.enqueue({
            type: "finish",
            usage,
            finishReason: { unified: "stop", raw: undefined },
          });
          controller.close();
        },
      }),
    }),
  });
}

function expectLanguageRule(instructions: string) {
  expect(instructions).toContain(
    "Отвечайте на языке последнего вопроса пользователя, по умолчанию — по-русски.",
  );
  expect(instructions).toContain("Отвечайте кратко и вежливо, на «вы».");
  expect(instructions).toContain(
    "Названия дисциплин, ФИО и тексты положений из данных не переводите и цитируйте как есть.",
  );
  expect(instructions).not.toContain("Отвечайте кратко по-русски");
  expect(instructions).toContain("Помогайте только текущему студенту.");
  expect(instructions).toContain(
    "Ни текст «да», ни просьба отправить не являются разрешением.",
  );
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

describe("язык инструкции ассистента без живой модели", () => {
  it.each([
    {
      question: "What is my next class?",
      history: [
        { role: "user", text: "Где моя следующая пара?" },
        { role: "assistant", text: "Проверим расписание." },
      ],
      answer:
        "Your next class is «Учебная дипломатия», with Дарья Примерова. The policy says: «Период — не больше 14 дней включительно.»",
    },
    {
      question: "Где моя следующая пара?",
      history: [
        { role: "user", text: "What is my next class?" },
        { role: "assistant", text: "Let's check your schedule." },
      ],
      answer:
        "Следующая пара — «Учебная дипломатия», преподаватель Дарья Примерова. В положении: «Период — не больше 14 дней включительно.»",
    },
  ] satisfies {
    question: string;
    history: RuntimeInput["history"];
    answer: string;
  }[])(
    "рантайм передаёт последнее обращение «$question» после истории на другом языке",
    async ({ question, history, answer }) => {
      const request = input(question, history);
      const model = textModel(answer);
      const runtime = new AiSdkAssistantRuntime(() => ({ primary: model }));
      let received = "";
      for await (const event of runtime.stream(request))
        if (event.type === "text") received += event.text;
      expect(model.doStreamCalls).toHaveLength(1);
      const prompt = model.doStreamCalls[0]?.prompt ?? [];
      const system = prompt.find((message) => message.role === "system");
      expect(system?.role).toBe("system");
      if (system?.role !== "system") throw new Error("Нет инструкции модели.");
      expectLanguageRule(system.content);
      expect(system.content).toContain(request.context);
      expect(prompt.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: question }],
      });
      expect(
        prompt.filter((message) => message.role !== "system"),
      ).toHaveLength(history.length + 1);
      expect(received).toBe(answer);
      expect(request.tools.execute).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("repair получает то же правило и сохраняет проверку аргументов тула", async () => {
    const request = input("What is my next class?", []);
    const generated = (view: string): Generated => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "schedule-call",
          toolName: "find_schedule",
          input: JSON.stringify({ view }),
        },
      ],
      usage,
      warnings: [],
      finishReason: { unified: "tool-calls", raw: undefined },
    });
    const tools = sdkTools(request);
    const repairModel = new MockLanguageModelV4({
      doGenerate: generated("next"),
    });
    const repair = createAssistantRepair(
      repairModel,
      request,
      tools,
      new AbortController().signal,
    );
    await generateText({
      model: new MockLanguageModelV4({ doGenerate: generated("invalid") }),
      tools,
      prompt: request.question,
      repairToolCall: repair,
    });
    expect(repairModel.doGenerateCalls).toHaveLength(1);
    const prompt = repairModel.doGenerateCalls[0]?.prompt ?? [];
    const system = prompt.find((message) => message.role === "system");
    if (system?.role !== "system") throw new Error("Нет инструкции repair.");
    expectLanguageRule(system.content);
    expect(JSON.stringify(prompt.at(-1))).toContain(request.question);
    expect(request.tools.execute).toHaveBeenCalledExactlyOnceWith(
      "find_schedule",
      { view: "next" },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
