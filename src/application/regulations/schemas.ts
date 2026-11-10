import { z } from "zod";
import { NotFoundError, ValidationError } from "../shared/errors";

const listSchema = z.strictObject({});
const searchSchema = z.strictObject({
  query: z
    .string()
    .refine(
      (value) =>
        !Array.from(value).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    )
    .trim()
    .min(1)
    .max(200),
});
const documentSchema = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z]+(?:-[a-z]+)*$/)
    .max(80),
});
const pageQuerySchema = z.strictObject({ q: z.string().optional() });

export function parseListInput(input: unknown) {
  if (!listSchema.safeParse(input).success) throw new NotFoundError();
}

export function parseSearchInput(input: unknown) {
  rejectOwner(input);
  const result = searchSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      query: ["INVALID_REGULATION_QUERY"],
    });
  return result.data;
}

export function parseDocumentInput(input: unknown) {
  const result = documentSchema.safeParse(input);
  if (!result.success) throw new NotFoundError();
  return result.data;
}

export function parsePageQuery(input: unknown) {
  const result = pageQuerySchema.safeParse(input);
  if (!result.success) throw new NotFoundError();
  return result.data;
}

function rejectOwner(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    ["studentId", "userId", "groupId"].some((key) => key in input)
  )
    throw new NotFoundError();
}
