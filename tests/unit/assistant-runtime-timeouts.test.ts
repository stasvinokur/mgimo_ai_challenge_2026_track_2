import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, RuntimeInput } from "@/application/assistant/ports";
import { createToolSchemas } from "@/application/assistant/schemas";
import { AiSdkAssistantRuntime } from "@/infrastructure/ai/ai-sdk-runtime";

type Stream = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type Part = Stream["stream"] extends ReadableStream<infer T> ? T : never;
const finish = (reason: "stop" | "tool-calls"): Part => ({
  type: "finish",
  finishReason: { unified: reason, raw: undefined },
  usage: {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
});
function input(): RuntimeInput {
  return {
    question: "Где следующая пара?",
    context: "{}",
    history: [],
    tools: {
      schemas: createToolSchemas([]),
      execute: vi.fn(async () => ({ next: null })),
    },
  };
}
function controlledModel() {
  const steps: {
    controller: ReadableStreamDefaultController<Part>;
    signal: AbortSignal | undefined;
  }[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => ({
      stream: new ReadableStream<Part>({
        start(controller) {
          steps.push({ controller, signal: options.abortSignal });
          controller.enqueue({ type: "stream-start", warnings: [] });
        },
      }),
    }),
  });
  const step = (index = 0) => {
    const value = steps[index];
    if (!value) throw new Error("MOCK_STEP_NOT_STARTED");
    return value;
  };
  return {
    model,
    steps,
    step,
    emit(part: Part, index = 0) {
      step(index).controller.enqueue(part);
    },
    end(reason: "stop" | "tool-calls" = "stop", index = 0) {
      step(index).controller.enqueue(finish(reason));
      step(index).controller.close();
    },
    answer(value: string, index = 0) {
      const { controller } = step(index);
      controller.enqueue({ type: "text-start", id: "answer" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: value });
      controller.enqueue({ type: "text-end", id: "answer" });
      controller.enqueue(finish("stop"));
      controller.close();
    },
  };
}
async function collect(stream: AsyncIterable<RuntimeEvent>) {
  const events: RuntimeEvent[] = [];
  try {
    for await (const event of stream) events.push(event);
    return { events, error: undefined };
  } catch (error) {
    return { events, error };
  }
}
const text = (events: RuntimeEvent[]) =>
  events.flatMap((event) => (event.type === "text" ? event.text : [])).join("");

describe("AI SDK: время потока на управляемых часах без сети", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout bypasses fake timers in the pre-fix runtime.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("", "TimeoutError")),
        ms,
      );
      return controller.signal;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("NETWORK_DISABLED"))),
    );
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("многошаговый поток длиннее 20 секунд доходит до конца", async () => {
    const request = input();
    const primary = controlledModel();
    const fallback = controlledModel();
    const result = collect(
      new AiSdkAssistantRuntime(() => ({
        primary: primary.model,
        fallback: fallback.model,
      })).stream(request),
    );
    await vi.advanceTimersByTimeAsync(8000);
    primary.emit({
      type: "tool-call",
      toolCallId: "schedule",
      toolName: "find_schedule",
      input: JSON.stringify({ view: "next" }),
    });
    await vi.advanceTimersByTimeAsync(8000);
    primary.end("tool-calls");
    await vi.advanceTimersByTimeAsync(8000);
    expect(primary.step(1).signal?.aborted).toBe(false);
    primary.emit({ type: "text-start", id: "answer" }, 1);
    primary.emit(
      { type: "text-delta", id: "answer", delta: "Первая часть. " },
      1,
    );
    await vi.advanceTimersByTimeAsync(8000);
    primary.emit(
      { type: "text-delta", id: "answer", delta: "Ответ завершён." },
      1,
    );
    await vi.advanceTimersByTimeAsync(8000);
    primary.emit({ type: "text-end", id: "answer" }, 1);
    primary.end("stop", 1);
    const outcome = await result;
    expect(outcome.error).toBeUndefined();
    expect(text(outcome.events)).toBe("Первая часть. Ответ завершён.");
    expect(primary.model.doStreamCalls).toHaveLength(2);
    expect(fallback.model.doStreamCalls).toHaveLength(0);
    expect(request.tools.execute).toHaveBeenCalledExactlyOnceWith(
      "find_schedule",
      {
        view: "next",
      },
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("начало текста сбрасывает простой до первого видимого фрагмента", async () => {
    const primary = controlledModel();
    const result = collect(
      new AiSdkAssistantRuntime(() => ({ primary: primary.model })).stream(
        input(),
      ),
    );
    await vi.advanceTimersByTimeAsync(29_000);
    primary.emit({ type: "text-start", id: "answer" });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(primary.step().signal?.aborted).toBe(false);
    primary.emit({ type: "text-delta", id: "answer", delta: "Готово." });
    primary.emit({ type: "text-end", id: "answer" });
    primary.end();
    expect(text((await result).events)).toBe("Готово.");
    expect((await result).error).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("вызов, результат тула и граница шагов продлевают поток без текста", async () => {
    const request = input();
    const toolResult = Promise.withResolvers<unknown>();
    request.tools.execute = vi.fn(() => toolResult.promise);
    const primary = controlledModel();
    const result = collect(
      new AiSdkAssistantRuntime(() => ({ primary: primary.model })).stream(
        request,
      ),
    );
    await vi.advanceTimersByTimeAsync(25_000);
    primary.emit({
      type: "tool-call",
      toolCallId: "schedule",
      toolName: "find_schedule",
      input: JSON.stringify({ view: "next" }),
    });
    primary.end("tool-calls");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(primary.step().signal?.aborted).toBe(false);
    toolResult.resolve({ next: null });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(primary.step(1).signal?.aborted).toBe(false);
    primary.answer("Следующая пара не найдена.", 1);
    const outcome = await result;
    expect(outcome.error).toBeUndefined();
    expect(text(outcome.events)).toBe("Следующая пара не найдена.");
    expect(primary.model.doStreamCalls).toHaveLength(2);
    expect(request.tools.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("30 секунд молчания до текста запускают запасную модель с новым простоем", async () => {
    const primary = controlledModel();
    const fallback = controlledModel();
    const result = collect(
      new AiSdkAssistantRuntime(() => ({
        primary: primary.model,
        fallback: fallback.model,
      })).stream(input()),
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(primary.step().signal?.aborted).toBe(false);
    expect(fallback.model.doStreamCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(primary.step().signal?.aborted).toBe(true);
    expect(fallback.model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fallback.step().signal?.aborted).toBe(false);
    fallback.answer("Ответ запасной модели.");
    const outcome = await result;
    expect(outcome.error).toBeUndefined();
    expect(text(outcome.events)).toBe("Ответ запасной модели.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("молчание обеих моделей возвращает безопасную ошибку после двух простоев", async () => {
    const primary = controlledModel();
    const fallback = controlledModel();
    const result = collect(
      new AiSdkAssistantRuntime(() => ({
        primary: primary.model,
        fallback: fallback.model,
      })).stream(input()),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const outcome = await result;
    expect(primary.step().signal?.aborted).toBe(true);
    expect(fallback.step().signal?.aborted).toBe(true);
    expect(outcome.error).toEqual(new Error("ASSISTANT_UNAVAILABLE"));
    expect(text(outcome.events)).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["простой", "ошибка"])(
    "%s после видимого текста не запускает второй ответ",
    async (failure) => {
      const primary = controlledModel();
      const fallback = controlledModel();
      const factory = vi.fn(() => ({
        primary: primary.model,
        fallback: fallback.model,
      }));
      const result = collect(
        new AiSdkAssistantRuntime(factory).stream(input()),
      );
      await vi.advanceTimersByTimeAsync(0);
      primary.emit({ type: "text-start", id: "answer" });
      primary.emit({
        type: "text-delta",
        id: "answer",
        delta: "Начало ответа.",
      });
      await vi.advanceTimersByTimeAsync(0);
      if (failure === "простой") await vi.advanceTimersByTimeAsync(30_000);
      else
        primary
          .step()
          .controller.error(new TypeError("PRIVATE_PROVIDER_ERROR"));
      const outcome = await result;
      expect(outcome.error).toEqual(new Error("ASSISTANT_UNAVAILABLE"));
      expect(text(outcome.events)).toBe("Начало ответа.");
      expect(fallback.model.doStreamCalls).toHaveLength(0);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("живой поток останавливается общим пределом 120 секунд", async () => {
    const primary = controlledModel();
    const fallback = controlledModel();
    const result = collect(
      new AiSdkAssistantRuntime(() => ({
        primary: primary.model,
        fallback: fallback.model,
      })).stream(input()),
    );
    await vi.advanceTimersByTimeAsync(0);
    primary.emit({ type: "text-start", id: "answer" });
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      primary.emit({ type: "text-delta", id: "answer", delta: "Часть. " });
    }
    await vi.advanceTimersByTimeAsync(19_999);
    expect(primary.step().signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await result;
    expect(primary.step().signal?.aborted).toBe(true);
    expect(outcome.error).toEqual(new Error("ASSISTANT_UNAVAILABLE"));
    expect(text(outcome.events)).toBe("Часть. ".repeat(5));
    expect(fallback.model.doStreamCalls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("общий предел не начинается заново для запасной модели и транспорта", async () => {
    const primary = controlledModel();
    const fallback = controlledModel();
    const compatibleFallback = controlledModel();
    const compatiblePrimary = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("MODEL_DOWN");
      },
    });
    const factory = vi.fn((_input: RuntimeInput, compatible: boolean) =>
      compatible
        ? { primary: compatiblePrimary, fallback: compatibleFallback.model }
        : { primary: primary.model, fallback: fallback.model },
    );
    const result = collect(new AiSdkAssistantRuntime(factory).stream(input()));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(primary.step().signal?.aborted).toBe(true);
    fallback.emit({ type: "reasoning-start", id: "thinking" });
    await vi.advanceTimersByTimeAsync(20_000);
    fallback.emit({ type: "reasoning-delta", id: "thinking", delta: "..." });
    await vi.advanceTimersByTimeAsync(10_000);
    fallback.step().controller.error(new TypeError("PROVIDER_DOWN"));
    await vi.advanceTimersByTimeAsync(0);
    expect(factory.mock.calls.map((args) => args[1])).toEqual([false, true]);
    expect(compatiblePrimary.doStreamCalls).toHaveLength(1);
    compatibleFallback.emit({ type: "reasoning-start", id: "thinking" });
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      compatibleFallback.emit({
        type: "reasoning-delta",
        id: "thinking",
        delta: "...",
      });
    }
    await vi.advanceTimersByTimeAsync(19_999);
    expect(compatibleFallback.step().signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await result;
    expect(compatibleFallback.step().signal?.aborted).toBe(true);
    expect(outcome.error).toEqual(new Error("ASSISTANT_UNAVAILABLE"));
    expect(text(outcome.events)).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("закрытие генератора очищает таймеры и освобождает слот", async () => {
    const primary = controlledModel();
    const runtime = new AiSdkAssistantRuntime(() => ({
      primary: primary.model,
    }));
    for (let i = 0; i < 4; i++) {
      const stream = runtime.stream(input());
      await expect(stream.next()).resolves.toMatchObject({ done: false });
      await vi.advanceTimersByTimeAsync(0);
      await stream.return(undefined);
      expect(primary.step(i).signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(primary.model.doStreamCalls).toHaveLength(4);
  });

  it("сохраняет 3 активных, очередь 8 и ожидание очереди 5 секунд", async () => {
    const primary = controlledModel();
    const runtime = new AiSdkAssistantRuntime(() => ({
      primary: primary.model,
    }));
    const results = Array.from({ length: 11 }, () =>
      collect(runtime.stream(input())),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(primary.model.doStreamCalls).toHaveLength(3);
    expect((await collect(runtime.stream(input()))).error).toEqual(
      new Error("ASSISTANT_BUSY"),
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(primary.model.doStreamCalls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    for (const result of results.slice(3))
      expect((await result).error).toEqual(new Error("ASSISTANT_BUSY"));
    for (let i = 0; i < 3; i++) primary.answer("Готово.", i);
    for (const result of results.slice(0, 3))
      expect((await result).error).toBeUndefined();
    const next = collect(runtime.stream(input()));
    await vi.advanceTimersByTimeAsync(0);
    expect(primary.model.doStreamCalls).toHaveLength(4);
    primary.answer("Новый ответ.", 3);
    expect((await next).error).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
