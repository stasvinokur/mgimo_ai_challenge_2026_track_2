import { MockLanguageModelV4 } from "ai/test";
import { isEventQuestion } from "@/application/assistant/event-fields";
import type { RuntimeInput } from "@/application/assistant/ports";

type Stream = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type Part = Stream["stream"] extends ReadableStream<infer T> ? T : never;
const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function scheduleLessonText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const fields: string[] = [];
  if ("course" in value && typeof value.course === "string")
    fields.push(value.course);
  if ("relativeTime" in value && typeof value.relativeTime === "string")
    fields.push(value.relativeTime);
  if ("startsAtMoscow" in value && typeof value.startsAtMoscow === "string")
    fields.push(`Начало: ${value.startsAtMoscow}`);
  if ("room" in value && typeof value.room === "string")
    fields.push(`Аудитория: ${value.room}`);
  return fields.length ? `${fields.join(". ")}.` : null;
}

function scheduleAnswer(result: unknown, question: string): string {
  if (!result || typeof result !== "object")
    return "Расписание сейчас недоступно. Повторите попытку позже.";
  if ("available" in result && result.available === false)
    return "Расписание сейчас недоступно. Повторите попытку позже.";
  if (/измен/iu.test(question) && "changes" in result) {
    const changes = Array.isArray(result.changes)
      ? result.changes.map(scheduleLessonText).filter(Boolean)
      : [];
    return changes.length ? changes.join("\n\n") : "На сегодня изменений нет.";
  }
  const next = "next" in result ? scheduleLessonText(result.next) : null;
  const current =
    "current" in result ? scheduleLessonText(result.current) : null;
  return (
    (/сейчас|текущ/iu.test(question) ? (current ?? next) : (next ?? current)) ??
    "Следующих занятий пока нет в расписании."
  );
}

export function assistantMockModel(input: RuntimeInput) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const parts: Part[] = [{ type: "stream-start", warnings: [] }];
      const call = (toolName: string, args: unknown) =>
        parts.push({
          type: "tool-call",
          toolCallId: `mock-${step}`,
          toolName,
          input: JSON.stringify(args),
        });
      const context = JSON.parse(input.context);
      const question = input.question;
      const toolResults = options.prompt
        .flatMap((message) => (message.role === "tool" ? message.content : []))
        .filter((part) => part.type === "tool-result");
      const last = toolResults.at(-1);
      const result = last?.output.type === "json" ? last.output.value : null;
      if (step++ === 0) {
        const history = input.history
          .filter((turn) => turn.role === "user")
          .map((turn) => turn.text);
        if (isEventQuestion(question, [...history, question].join("\n"))) {
          const name = [question, ...history.slice().reverse()]
            .map(
              (words) =>
                words
                  .match(/(?:название|мероприятие)\s*[:—-]\s*([^\n;]+)/iu)?.[1]
                  ?.trim() ??
                words.match(/хакатон|олимпиад[ау]|конференци[яю]/iu)?.[0],
            )
            .find(Boolean);
          call("draft_request", {
            type: "event_release",
            fields: name ? { eventName: name } : {},
          });
        } else if (/справк|бумаг|работодател/iu.test(question)) {
          const type = /виз/iu.test(question)
            ? "visa"
            : /военком/iu.test(question)
              ? "military"
              : /стипенди/iu.test(question)
                ? "scholarship"
                : "enrollment";
          const destination = question
            .match(/получатель\s*[:—-]\s*(.+)/iu)?.[1]
            ?.trim();
          call("draft_request", {
            type,
            fields: destination ? { destination } : {},
          });
        } else if (/что.*если|получу/iu.test(question)) {
          const courses = context.grades?.courses ?? [];
          const course =
            courses.find((item: { title: string }) =>
              /иностран/iu.test(item.title),
            ) ?? courses[0];
          const work = course?.pending[0];
          if (course && work)
            call("what_if", {
              courseId: course.id,
              predictions: [
                {
                  assessmentId: work.id,
                  score: Number(question.match(/\d+/)?.[0] ?? 80),
                },
              ],
            });
        } else if (/долг|оценк/iu.test(question)) call("explain_grade", {});
        else if (/пар|измен/iu.test(question))
          call("find_schedule", {
            view: /измен/iu.test(question) ? "changes" : "next",
          });
        else call("search_regulations", { query: question.slice(0, 200) });
      } else if (
        last?.toolName === "draft_request" &&
        result &&
        typeof result === "object" &&
        "id" in result
      )
        call("submit_request", { draftId: result.id });
      if (!parts.some((part) => part.type === "tool-call")) {
        const text =
          last?.toolName === "what_if"
            ? `Расчёт по вашим работам: ${JSON.stringify(result)}. Баллы рассчитаны правилами сервиса.`
            : last?.toolName === "find_schedule"
              ? `Проверьте сведения и источники ниже.\n\n${scheduleAnswer(result, question)}`
              : "Проверьте сведения и источники ниже. Заявку отправите вы после проверки черновика.";
        parts.push({ type: "text-start", id: "text" });
        for (const delta of text.match(/[\s\S]{1,24}/gu) ?? [])
          parts.push({ type: "text-delta", id: "text", delta });
        parts.push({ type: "text-end", id: "text" });
      }
      parts.push({
        type: "finish",
        finishReason: {
          unified: parts.some((part) => part.type === "tool-call")
            ? "tool-calls"
            : "stop",
          raw: undefined,
        },
        usage,
      });
      return {
        stream: new ReadableStream<Part>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
}
