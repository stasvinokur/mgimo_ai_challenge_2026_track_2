import { z } from "zod";
import { ValidationError } from "../shared/errors";

export const attendanceCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const dateSchema = z.iso.date();
const lessonSchema = z.strictObject({
  slotId: z.uuid(),
  occurrenceDate: dateSchema,
});
const ipSchema = z.string().min(1).max(64);
const closeSchema = lessonSchema.extend({ ip: ipSchema });
const issueSchema = z.strictObject({
  lesson: lessonSchema,
  ip: ipSchema,
  previousCode: attendanceCodeSchema.optional(),
});
const confirmSchema = z.strictObject({ code: attendanceCodeSchema });
const markSchema = confirmSchema.extend({ ip: ipSchema });
const emptySchema = z.strictObject({});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ValidationError({ input: ["Проверьте параметры отметки."] });
  return result.data;
}
export const parseLesson = (input: unknown) => parse(lessonSchema, input);
export const parseIssue = (input: unknown) => parse(issueSchema, input);
export const parseConfirmation = (input: unknown) =>
  confirmSchema.safeParse(input);
export const parseAttendanceQuery = (input: unknown) =>
  parse(emptySchema, input);

export const parseClose = (input: unknown) => parse(closeSchema, input);
export const parseMark = (input: unknown) => markSchema.safeParse(input);
export function parseAttendanceIp(input: unknown): string {
  return parse(
    ipSchema,
    typeof input === "object" && input !== null && "ip" in input
      ? input.ip
      : undefined,
  );
}
