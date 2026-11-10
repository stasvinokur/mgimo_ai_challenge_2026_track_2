import { z } from "zod";
import { reasonCodes } from "@/domain/grades/score-reasons";
import { NotFoundError, ValidationError } from "../shared/errors";

const lessonSchema = z.strictObject({
  slotId: z.uuid(),
  occurrenceDate: z.iso.date(),
});
const gradeSchema = lessonSchema.extend({
  entryKey: z.string().regex(/^[a-f0-9]{32}$/),
  score: z.number(),
  expectedScore: z.number().int().nonnegative().nullable(),
  reason: z.enum(reasonCodes).optional(),
});

export function parseGradebookLesson(input: unknown) {
  const result = lessonSchema.safeParse(input);
  if (!result.success) throw new NotFoundError();
  return result.data;
}

export function parseTeacherGrade(input: unknown) {
  const result = gradeSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      input: ["Проверьте параметры ведомости и балл."],
    });
  return result.data;
}
