import { describe, expect, it, vi } from "vitest";
import type { AssistantRuntime } from "@/application/assistant/ports";
import type { Lesson } from "@/application/schedule/get-schedule";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import {
  assistantFixture,
  collect,
  threadId,
  toolRuntime,
} from "../fakes/assistant";

const intentions = [
  {
    key: "nextQuestion",
    free: "When is my next lesson?",
    code: "nextLesson",
    tool: "find_schedule",
  },
  {
    key: "changesQuestion",
    free: "Are there any changes to my timetable?",
    code: "changedLesson",
    tool: "find_schedule",
  },
  {
    key: "debtsQuestion",
    free: "Do I have any academic debts?",
    code: "debts",
    tool: "explain_grade",
  },
  {
    key: "certificateQuestion",
    free: "Please prepare a certificate for my employer.",
    code: "draftSaved",
    tool: "draft_request",
  },
] as const;

const next: Lesson = {
  id: "lesson-next",
  uid: "lesson-next:occurrence",
  date: "2026-11-04",
  course: "Учебный курс",
  teacher: "Вымышленный преподаватель",
  room: "312",
  startsAt: "2026-11-04T10:00:00.000Z",
  endsAt: "2026-11-04T11:30:00.000Z",
  kind: "seminar",
  status: "scheduled",
  changes: [],
  revision: 0,
  updatedAt: "2026-11-01T00:00:00.000Z",
};

async function fixture(
  runtime = toolRuntime(async () => {
    throw new Error("RUNTIME_UNAVAILABLE");
  }),
) {
  const stream = vi.spyOn(runtime, "stream");
  const f = assistantFixture(runtime);
  f.regulationDb.matches = [];
  const today = await f.deps.schedule.getToday.execute(f.actor);
  vi.spyOn(f.deps.schedule.getToday, "execute").mockResolvedValue({
    ...today,
    next,
    changes: [next],
  });
  const grades = await f.deps.grades.getMyGrades.execute(f.actor);
  vi.spyOn(f.deps.grades.getMyGrades, "execute").mockResolvedValue({
    ...grades,
    summary: { ...grades.summary, openDebts: 2 },
    courses: grades.courses.map((course) => ({ ...course, openDebts: 2 })),
  });
  return { ...f, stream, today, grades };
}

describe("Ассистент: английские намерения без ИИ", () => {
  const cases = intentions.flatMap((intent) => [
    {
      ...intent,
      variant: "русская кнопка",
      question: assistantMessages[intent.key].ru,
    },
    {
      ...intent,
      variant: "английская кнопка",
      question: assistantMessages[intent.key].en,
    },
    { ...intent, variant: "свободный английский", question: intent.free },
  ]);

  it.each(cases)(
    "$variant: $question → $code",
    async ({ question, code, tool, key }) => {
      const f = await fixture();
      const events = await collect(
        await f.ask.execute(f.actor, { action: "ask", threadId, question }),
      );
      expect(f.stream).toHaveBeenCalledOnce();
      expect(events).toContainEqual({ type: "mode", mode: "fallback" });
      expect(events).toContainEqual({
        type: "message",
        code: "fallbackStart",
        params: {},
      });
      expect(f.regulationDb.calls).toEqual([]);
      expect(f.journal.entries).toHaveLength(1);
      expect(f.journal.entries[0]).toMatchObject({
        question,
        tools: [tool],
        outcome: "fallback",
      });
      if (key === "certificateQuestion") {
        expect(events).toContainEqual({ type: "message", code, params: {} });
        const card = events.find((event) => event.type === "draft");
        expect(card).toMatchObject({
          type: "draft",
          draft: {
            typeCode: "enrollment",
            canSubmit: true,
            approvalId: expect.any(String),
          },
        });
        expect(f.db.records).toHaveLength(1);
        expect(f.db.records[0]).toMatchObject({
          typeCode: "enrollment",
          status: "draft",
          submittedAt: null,
          payload: {
            destination: question.match(/работодателя|employer/u)?.[0],
          },
        });
        expect(f.db.records[0]?.payload).not.toHaveProperty("country");
      } else {
        expect(f.db.records).toEqual([]);
        expect(events.some((event) => event.type === "draft")).toBe(false);
        expect(events).toContainEqual({
          type: "message",
          code,
          params:
            key === "debtsQuestion"
              ? {
                  count: 2,
                  courses: f.grades.courses
                    .map((course) => course.title)
                    .join(", "),
                }
              : {
                  course: next.course,
                  room: next.room,
                  startsAt: next.startsAt,
                  endsAt: next.endsAt,
                  status: next.status,
                  now: f.today.now,
                },
        });
      }
      expect(events.some((event) => event.type === "submitted")).toBe(false);
      expect(f.db.events).toEqual([]);
    },
  );

  it.each([
    {
      question: "My employer has changed; I need a certificate for my EMPLOYER",
      destination: "employer",
    },
    {
      question: "I need a certificate for my EMPLOYER",
      destination: "EMPLOYER",
    },
    {
      question: "Нужна справка для работодателя (employer)",
      destination: "работодателя",
    },
  ])(
    "получатель сохраняется дословно с приоритетом русского: $question",
    async ({ question, destination }) => {
      const f = await fixture();
      const events = await collect(
        await f.ask.execute(f.actor, { action: "ask", threadId, question }),
      );
      expect(events).toContainEqual({ type: "mode", mode: "fallback" });
      expect(events.find((event) => event.type === "draft")).toMatchObject({
        draft: { typeCode: "enrollment", canSubmit: true },
      });
      expect(f.db.records).toHaveLength(1);
      expect(f.db.records[0]).toMatchObject({
        typeCode: "enrollment",
        status: "draft",
        payload: { destination },
      });
      expect(f.regulationDb.calls).toEqual([]);
      expect(f.journal.entries[0]?.tools).toEqual(["draft_request"]);
      expect(f.db.events).toEqual([]);
    },
  );

  it.each(intentions)(
    "успешный runtime не подменяется для $key",
    async ({ key }) => {
      const answer = "An unchanged model answer: «example» <example>.";
      const runtime: AssistantRuntime = {
        async *stream() {
          yield { type: "text", text: answer };
        },
      };
      const f = await fixture(runtime);
      const question = assistantMessages[key].en;
      const events = await collect(
        await f.ask.execute(f.actor, { action: "ask", threadId, question }),
      );
      expect(events).toEqual([{ type: "text", text: answer }]);
      expect(f.stream).toHaveBeenCalledOnce();
      expect(f.stream.mock.calls[0]?.[0].question).toBe(question);
      expect(f.db.records).toEqual([]);
      expect(f.journal.entries[0]).toMatchObject({
        tools: [],
        outcome: "answered",
      });
    },
  );
});
