import { z } from "zod";
import { NotFoundError } from "../shared/errors";

const courseSchema = z.object({ courseId: z.uuid() }).strict();

export function parseCourseInput(input: unknown) {
  const result = courseSchema.safeParse(input);
  if (!result.success) throw new NotFoundError();
  return result.data;
}

const courseActionsSchema = courseSchema.extend({
  workId: z.uuid().optional(),
});

export function parseCourseActionsInput(input: unknown) {
  const result = courseActionsSchema.safeParse(input);
  if (!result.success) throw new NotFoundError();
  return result.data;
}
