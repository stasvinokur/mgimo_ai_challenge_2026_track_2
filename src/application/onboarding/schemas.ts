import { z } from "zod";
import { manualStepCodes } from "@/domain/onboarding/steps";
import { ValidationError } from "@/domain/shared/errors";

const completeSchema = z.strictObject({ stepCode: z.enum(manualStepCodes) });
const actionSchema = z.union([
  completeSchema,
  z.strictObject({ action: z.literal("hide") }),
]);

export function parseCompleteStep(input: unknown) {
  const result = completeSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({ stepCode: ["Выберите шаг для отметки."] });
  return result.data;
}

export function parseOnboardingAction(input: unknown) {
  const result = actionSchema.safeParse(input);
  if (!result.success)
    throw new ValidationError({
      onboarding: ["Проверьте выбранное действие."],
    });
  return result.data;
}
