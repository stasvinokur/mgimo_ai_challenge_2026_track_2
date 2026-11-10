import { isDeepStrictEqual } from "node:util";
import { APICallError, generateText, isStepCount, streamText } from "ai";
import { instructions } from "./fixtures.js";
import { createTools, schemas } from "./tools.js";

export function safeError(error) {
  return APICallError.isInstance(error)
    ? `Ошибка HTTP ${error.statusCode ?? "без статуса"}`
    : error instanceof Error && error.name === "TimeoutError"
      ? "Истёк таймаут"
      : "Ошибка выполнения SDK или сети";
}

function parseInput(input) {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function callData(call) {
  return { toolName: call.toolName, input: parseInput(call.input) };
}

export function validCalls(calls) {
  return (
    calls.length > 0 &&
    calls.every(
      (call) => schemas[call.toolName]?.safeParse(call.input).success === true,
    )
  );
}

// A single re-ask uses the original task and validation error, never the fixture answer.
/** @returns {import("ai").ToolCallRepairFunction<import("ai").ToolSet>} */
export function createRepair(model, fixture, tools, events, signal) {
  let attempted = false;
  return async ({ toolCall, error, inputSchema }) => {
    if (attempted) return null;
    attempted = true;
    const event = {
      original: callData(toolCall),
      validationError: error.message,
      repaired: null,
    };
    events.push(event);
    const repairTools = Object.fromEntries(
      Object.entries(tools).map(([name, definition]) => [
        name,
        {
          description: definition.description,
          inputSchema: definition.inputSchema,
        },
      ]),
    );
    const result = await generateText({
      model,
      instructions,
      tools: repairTools,
      prompt: `${fixture.prompt}\nПредыдущий вызов: ${JSON.stringify(event.original)}. Ошибка валидации: ${error.message}. Исправь вызов один раз. Схема: ${JSON.stringify(await inputSchema({ toolName: toolCall.toolName }))}`,
      temperature: 0,
      maxOutputTokens: 2048,
      maxRetries: 0,
      abortSignal: signal,
    });
    const call = result.toolCalls[0];
    if (result.toolCalls.length !== 1 || !call || !validCalls([callData(call)]))
      return null;
    event.repaired = callData(call);
    return {
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    };
  };
}

export async function measure(model, fixture, { stream = false } = {}) {
  const started = performance.now();
  const repairs = [];
  const tools = createTools();
  const signal = AbortSignal.timeout(60000);
  let firstDeltaMs = null;
  let textChunks = 0;
  let initial;
  let generatedText = "";
  let approvalRequested = false;
  try {
    const options = {
      model,
      instructions,
      prompt: fixture.prompt,
      tools,
      stopWhen: isStepCount(2),
      temperature: 0,
      maxOutputTokens: 2048,
      maxRetries: 0,
      abortSignal: signal,
      repairToolCall: createRepair(model, fixture, tools, repairs, signal),
    };
    let steps;
    if (stream) {
      const result = streamText({ ...options, onError: () => {} });
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") {
          firstDeltaMs ??= Math.round(performance.now() - started);
          textChunks++;
          generatedText += part.text;
        }
      }
      steps = await result.steps;
    } else {
      const result = await generateText(options);
      steps = result.steps;
      generatedText = result.text;
    }
    const first = steps[0];
    const finalCalls = first?.toolCalls.map(callData) ?? [];
    initial = finalCalls.map(
      (call) =>
        repairs.find(
          (event) => event.repaired && isDeepStrictEqual(event.repaired, call),
        )?.original ?? call,
    );
    // Failed repairs may remain invalid in the final step; the original is still measured.
    if (repairs.length && !initial.length)
      initial = repairs.map((event) => event.original);
    approvalRequested = steps.some((step) =>
      step.content.some((part) => part.type === "tool-approval-request"),
    );
    const correctTool =
      fixture.tool === null
        ? initial.length === 0
        : initial.length === 1 && initial[0].toolName === fixture.tool;
    const expectedArguments =
      fixture.tool === null
        ? finalCalls.length === 0
        : finalCalls.length === 1 &&
          finalCalls[0].toolName === fixture.tool &&
          isDeepStrictEqual(finalCalls[0].input, fixture.input);
    return {
      fixture: fixture.id,
      initialCalls: initial,
      finalCalls,
      correctTool,
      expectedArguments,
      validImmediately: validCalls(initial),
      validAfterRepair: validCalls(finalCalls),
      repairs,
      approvalRequested,
      text: generatedText,
      textChunks,
      firstDeltaMs,
      latencyMs: Math.round(performance.now() - started),
      error: null,
    };
  } catch (error) {
    return {
      fixture: fixture.id,
      initialCalls: initial ?? repairs.map((event) => event.original),
      finalCalls: [],
      correctTool: false,
      expectedArguments: false,
      validImmediately: false,
      validAfterRepair: false,
      repairs,
      approvalRequested,
      text: generatedText,
      textChunks,
      firstDeltaMs,
      latencyMs: Math.round(performance.now() - started),
      error: safeError(error),
    };
  }
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

export function summarize(samples) {
  const calls = samples.filter((sample) => sample.initialCalls.length > 0);
  return {
    requests: samples.length,
    errors: samples.filter((sample) => sample.error).length,
    correctTools: samples.filter((sample) => sample.correctTool).length,
    requestsWithCalls: calls.length,
    validImmediately: calls.filter((sample) => sample.validImmediately).length,
    validAfterRepair: calls.filter((sample) => sample.validAfterRepair).length,
    expectedArguments: samples.filter((sample) => sample.expectedArguments)
      .length,
    repairRequests: samples.filter((sample) => sample.repairs.length > 0)
      .length,
    p50Ms: percentile(
      samples.map((sample) => sample.latencyMs),
      0.5,
    ),
    p95Ms: percentile(
      samples.map((sample) => sample.latencyMs),
      0.95,
    ),
  };
}

export async function probeRepair(model) {
  const fixture = {
    prompt: "Мне нужна бумага для работодателя ООО Альта, что я тут учусь.",
  };
  const original = {
    type: "tool-call",
    toolCallId: "injected-invalid-enum",
    toolName: "draft_request",
    input: JSON.stringify({
      type: "справка об учебе",
      fields: { recipient: "ООО Альта" },
    }),
  };
  const validation = schemas.draft_request.safeParse(
    parseInput(original.input),
  );
  const events = [];
  const repair = createRepair(
    model,
    fixture,
    createTools(),
    events,
    AbortSignal.timeout(60000),
  );
  const started = performance.now();
  try {
    const repaired = await repair({
      toolCall: original,
      error: validation.error,
      inputSchema: async () =>
        (await import("zod")).z.toJSONSchema(schemas.draft_request),
    });
    return {
      injected: true,
      events,
      valid: repaired !== null && validCalls([callData(repaired)]),
      latencyMs: Math.round(performance.now() - started),
      error: null,
    };
  } catch (error) {
    return {
      injected: true,
      events,
      valid: false,
      latencyMs: Math.round(performance.now() - started),
      error: safeError(error),
    };
  }
}
