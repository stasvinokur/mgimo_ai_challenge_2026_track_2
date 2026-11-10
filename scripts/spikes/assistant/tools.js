import { tool } from "ai";
import { z } from "zod";
import { certificateTypes } from "./fixtures.js";

export const schemas = {
  draft_request: z.strictObject({
    type: z.enum(certificateTypes),
    fields: z.strictObject({
      recipient: z.string().min(1).optional(),
      country: z.string().min(1).optional(),
    }),
  }),
  find_schedule: z.strictObject({
    date: z.iso.date(),
    view: z.enum(["next", "changes", "day"]),
  }),
  explain_grade: z.strictObject({ course: z.enum(["all", "economics"]) }),
  what_if: z.strictObject({
    course: z.literal("economics"),
    scores: z
      .array(
        z.strictObject({
          assessment: z.literal("control"),
          score: z.number().int().min(0).max(10),
        }),
      )
      .min(1)
      .max(1),
  }),
  search_regulations: z.strictObject({ query: z.string().min(1).max(200) }),
  submit_request: z.strictObject({ draftId: z.literal("draft-demo-1") }),
};

export function createTools(onSubmit = () => {}) {
  return {
    draft_request: tool({
      description: "Подготовить черновик справки. Не отправляет заявку.",
      inputSchema: schemas.draft_request,
      execute: async (input) => ({
        draftId: "draft-demo-1",
        status: "draft",
        ...input,
      }),
    }),
    find_schedule: tool({
      description:
        "Расписание текущего студента на московскую дату; следующая пара, изменения или весь день.",
      inputSchema: schemas.find_schedule,
      execute: async (input) => ({
        ...input,
        nextClass: { course: "Экономика", time: "11:00", room: "305" },
        changes: ["Аудитория изменена с 201 на 305"],
      }),
    }),
    explain_grade: tool({
      description:
        "Оценки и долги только текущего студента; all — сводка по всем курсам.",
      inputSchema: schemas.explain_grade,
      execute: async (input) => ({
        ...input,
        debts: [],
        currentScore: 7,
        scale: 10,
      }),
    }),
    what_if: tool({
      description:
        "Детерминированный расчёт результата при заданных баллах. Только экономика и одна контрольная в спайке.",
      inputSchema: schemas.what_if,
      execute: async (input) => ({
        ...input,
        forecastScore:
          Math.round((7 * 0.6 + input.scores[0].score * 0.4) * 10) / 10,
        explanation: "Текущий балл 7 с весом 0,6 и контрольная с весом 0,4",
        demo: true,
      }),
    }),
    search_regulations: tool({
      description: "Найти пункт вымышленного регламента деканата.",
      inputSchema: schemas.search_regulations,
      execute: async () => ({
        quote: "Справку готовят в течение трёх рабочих дней.",
        citation: "§ 3.2 Положения о справках",
        demo: true,
      }),
    }),
    submit_request: tool({
      description:
        "Отправить принадлежащий текущему студенту черновик только после отдельного подтверждения.",
      inputSchema: schemas.submit_request,
      needsApproval: true,
      execute: async ({ draftId }) => {
        onSubmit();
        return { draftId, status: "submitted" };
      },
    }),
  };
}
