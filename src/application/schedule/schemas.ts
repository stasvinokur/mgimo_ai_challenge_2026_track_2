import { z } from "zod";
import { dateFromWeek, isoWeek } from "@/domain/schedule/dates";
import { NotFoundError, ValidationError } from "../shared/errors";

export const weekSchema = z
  .string()
  .regex(/^(?:20\d{2})-W(?:0[1-9]|[1-4]\d|5[0-3])$/)
  .pipe(
    z
      .string()
      .refine(
        (week) => isoWeek(dateFromWeek(week)) === week,
        "Такой недели нет.",
      ),
  );

export const scheduleQuerySchema = z.strictObject({
  week: weekSchema.optional(),
  view: z.enum(["today", "week"]).optional(),
});
export const calendarTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const calendarActionSchema = z.strictObject({});

export function parseScheduleQuery(input: unknown) {
  rejectOwnerInput(input);
  const parsed = scheduleQuerySchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError({
      week: ["Укажите существующую неделю в формате ГГГГ-WНН."],
    });
  return parsed.data;
}

export function parseCalendarAction(input: unknown) {
  const result = calendarActionSchema.safeParse(input);
  if (!result.success) throw new NotFoundError();
}

function rejectOwnerInput(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    ["studentId", "userId", "groupId", "token"].some((key) => key in input)
  )
    throw new NotFoundError();
}
