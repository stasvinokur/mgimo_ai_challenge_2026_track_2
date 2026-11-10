import { z } from "zod";
import { ValidationError } from "../shared/errors";

export type SearchValidationCode = "controlCharacters" | "queryLength";

const searchSchema = z.strictObject({
  q: z
    .string()
    .regex(/^\P{Cc}*$/u)
    .pipe(z.string().trim().min(2).max(80)),
});

export function parseSearchInput(input: unknown) {
  const result = searchSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      q: [
        result.error.issues.some(
          (issue) =>
            issue.code === "invalid_format" && issue.format === "regex",
        )
          ? "controlCharacters"
          : "queryLength",
      ],
    });
  return result.data;
}
