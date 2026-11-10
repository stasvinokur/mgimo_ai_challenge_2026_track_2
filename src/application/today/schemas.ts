import { z } from "zod";
import { ValidationError } from "../shared/errors";

const checksumSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Некорректная контрольная сумма фразы.");

export function parseBriefingChecksum(input: unknown): string {
  const result = checksumSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      checksum: ["Некорректная контрольная сумма фразы."],
    });
  return result.data;
}
