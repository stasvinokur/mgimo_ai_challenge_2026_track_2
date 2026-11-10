import { z } from "zod";
import { isTrustedPushEndpoint } from "@/domain/notifications/push-subscription-policy";
import { ValidationError } from "@/domain/shared/errors";

const endpoint = z.string().max(2048).refine(isTrustedPushEndpoint);
const endpointSchema = z.strictObject({ endpoint });
const subscriptionSchema = z.strictObject({
  endpoint,
  expirationTime: z.number().nonnegative().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});

export function parsePushEndpoint(input: unknown) {
  const result = endpointSchema.safeParse(input);
  if (!result.success) throw invalidPushSubscription();
  return result.data;
}

export function parsePushSubscription(input: unknown) {
  const result = subscriptionSchema.safeParse(input);
  if (!result.success) throw invalidPushSubscription();
  return { endpoint: result.data.endpoint, keys: result.data.keys };
}

export function invalidPushSubscription() {
  return new ValidationError({
    subscription: ["Не удалось настроить уведомления. Попробуйте ещё раз."],
  });
}
