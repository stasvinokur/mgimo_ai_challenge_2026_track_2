import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeInput } from "@/application/assistant/ports";
import { createToolSchemas } from "@/application/assistant/schemas";
import { AiSdkAssistantRuntime } from "@/infrastructure/ai/ai-sdk-runtime";
import { assistantMockModel } from "@/infrastructure/ai/mock-model";

function moscowTime(instant: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));
}

function moscowDateTime(instant: string) {
  return `${new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(instant))} МСК`;
}

function lesson(relativeTime: string) {
  const startsAt = "2026-11-05T12:15:00Z";
  return {
    course: "Учебная дипломатия",
    room: "Д-204",
    startsAt,
    startsAtMoscow: moscowDateTime(startsAt),
    relativeTime,
  };
}

async function answer(question: string, result: unknown) {
  const input: RuntimeInput = {
    question,
    history: [],
    context: JSON.stringify({
      now: "2026-11-05T12:06:00Z",
      nowMoscow: moscowDateTime("2026-11-05T12:06:00Z"),
      schedule: {},
    }),
    tools: {
      schemas: createToolSchemas([]),
      execute: vi.fn(async () => result),
    },
  };
  const model = assistantMockModel(input);
  const runtime = new AiSdkAssistantRuntime(() => ({ primary: model }));
  let text = "";
  for await (const event of runtime.stream(input)) {
    if (event.type === "text") text += event.text;
  }
  return { text, input, model };
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

describe("Mock ассистента: готовое время расписания", () => {
  it.each([
    ["через 9 минут", "next", "Где следующая пара?"],
    [
      `идёт сейчас, до ${moscowTime("2026-11-05T13:45:00Z")} МСК`,
      "current",
      "Какая пара идёт сейчас?",
    ],
    [
      `завтра в ${moscowTime("2026-11-06T06:00:00Z")}`,
      "next",
      "Где следующая пара?",
    ],
    ["готовое время из тула", "next", "Где следующая пара?"],
  ])("копирует relativeTime «%s»", async (relativeTime, key, question) => {
    const ready = lesson(relativeTime);
    const { text, input } = await answer(question, {
      available: true,
      [key]: ready,
    });
    expect(input.tools.execute).toHaveBeenCalledWith("find_schedule", {
      view: "next",
    });
    expect(text).toContain(ready.relativeTime);
    expect(text).toContain(ready.startsAtMoscow);
    expect(text).toContain(ready.room);
    expect(text).not.toContain(ready.startsAt);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ответ на изменения также копирует готовое время пары", async () => {
    const ready = lesson("через 9 минут");
    const { text, input } = await answer("Что изменилось?", {
      available: true,
      changes: [ready],
    });
    expect(input.tools.execute).toHaveBeenCalledWith("find_schedule", {
      view: "changes",
    });
    expect(text).toContain(ready.relativeTime);
    expect(text).toContain(ready.startsAtMoscow);
    expect(text).not.toContain(ready.startsAt);
  });

  it("поток сохраняет разделение между двумя изменениями", async () => {
    const first = lesson("через 9 минут");
    const second = {
      ...lesson("завтра в готовое время"),
      course: "Учебная экономика",
    };
    const { text } = await answer("Что изменилось?", {
      available: true,
      changes: [first, second],
    });
    expect(text).toContain(`Аудитория: ${first.room}.\n\n${second.course}.`);
    expect(text.split("\n\n")).toHaveLength(3);
  });

  it("без готовых полей не вычисляет время из UTC", async () => {
    const { text } = await answer("Где следующая пара?", {
      available: true,
      next: {
        course: "Учебная дипломатия",
        startsAt: "2026-11-05T12:15:00Z",
      },
    });
    expect(text).toBe(
      "Проверьте сведения и источники ниже.\n\nУчебная дипломатия.",
    );
  });

  it("production-промпт запрещает модели пересчитывать UTC и разницу", async () => {
    const { model } = await answer("Что изменилось?", {
      changes: [lesson("через 9 минут")],
    });
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain("nowMoscow");
    expect(prompt).toContain("startsAtMoscow");
    expect(prompt).toContain("endsAtMoscow");
    expect(prompt).toContain("только из готового поля relativeTime");
    expect(prompt).toContain("Не вычисляйте разницу времени");
    expect(prompt).toContain("не пересчитывайте UTC");
  });
});
