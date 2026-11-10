import { z } from "zod";
import type { RequestTypeDto } from "../requests/dto";
import { ValidationError } from "../shared/errors";

const threadId = z.uuid();
const question = z.string().trim().min(1).max(2000);
export const submitRequestToolSchema = z.strictObject({ draftId: z.uuid() });
export const assistantInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("ask"), threadId, question }),
  z.strictObject({
    action: z.literal("approve"),
    threadId,
    approvalId: z.uuid(),
    approved: z.boolean(),
  }),
]);
export function parseAssistantInput(input: unknown) {
  const result = assistantInputSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      question: [
        "Напишите вопрос до 2000 символов или откройте черновик заново.",
      ],
    });
  return result.data;
}

export function createToolSchemas(types: RequestTypeDto[]) {
  const fields = Object.fromEntries(
    types.flatMap((type) =>
      type.fields.map((field) => [
        field.name,
        z.string().min(1).max(field.maxLength).optional(),
      ]),
    ),
  );
  return {
    find_schedule: z.strictObject({
      view: z.enum(["next", "changes", "week"]),
    }),
    explain_grade: z.strictObject({ courseId: z.uuid().optional() }),
    what_if: z.strictObject({
      courseId: z.uuid(),
      predictions: z
        .array(
          z.strictObject({
            assessmentId: z.uuid(),
            score: z.number().int().min(0).max(1000),
          }),
        )
        .min(1)
        .max(20),
    }),
    search_regulations: z.strictObject({ query: z.string().min(1).max(200) }),
    draft_request: z.strictObject({
      type: z.enum(types.map((type) => type.code)),
      fields: z.strictObject(fields),
      draftId: z.uuid().optional(),
    }),
    submit_request: submitRequestToolSchema,
  };
}

export function parseToolInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ValidationError({ tool: ["Проверьте аргументы действия."] });
  return result.data;
}
