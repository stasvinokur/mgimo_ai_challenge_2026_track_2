import { z } from "zod";
import { requestCommentSchema } from "../requests/schemas";
import { ValidationError } from "../shared/errors";

const filters = z.object({
  type: z
    .string()
    .max(80)
    .regex(/^[a-z_]*$/)
    .catch(""),
  sla: z.enum(["all", "on_time", "soon", "overdue"]).catch("all"),
  scope: z.enum(["all", "mine"]).catch("all"),
  q: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .regex(/^(?:З-\d{4}-\d{0,10})?$/)
    .catch(""),
});
export function parseStaffFilters(input: unknown) {
  return filters.parse(input && typeof input === "object" ? input : {});
}
export type StaffFilters = ReturnType<typeof parseStaffFilters>;

const change = z.strictObject({
  id: z.uuid(),
  to: z.enum([
    "accepted",
    "in_progress",
    "needs_info",
    "ready",
    "issued",
    "rejected",
  ]),
  comment: requestCommentSchema.optional(),
  commentCode: z.string().max(80).optional(),
});
export function parseStaffChange(input: unknown) {
  const parsed = change.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      Object.fromEntries(
        Object.entries(z.flattenError(parsed.error).fieldErrors).filter(
          (entry): entry is [string, string[]] => Array.isArray(entry[1]),
        ),
      ),
    );
  }
  return parsed.data;
}
