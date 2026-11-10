import { z } from "zod";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";

const idSchema = z.uuid();
const readSchema = z.strictObject({
  id: idSchema,
  open: z.boolean().optional(),
});
const latestSchema = z.strictObject({ latestAt: z.iso.datetime() });

export function parseReadNotification(input: unknown) {
  const result = readSchema.safeParse(input);
  if (!result.success) {
    if (
      typeof input === "object" &&
      input !== null &&
      "id" in input &&
      !idSchema.safeParse(input.id).success
    )
      throw new NotFoundError();
    throw new ValidationError({
      notification: ["notificationInvalid"],
    });
  }
  return result.data;
}

export function parseLatestNotification(input: unknown) {
  const result = latestSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      notification: ["notificationInvalid"],
    });
  return result.data;
}
