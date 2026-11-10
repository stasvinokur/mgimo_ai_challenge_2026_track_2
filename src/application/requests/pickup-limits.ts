import type { RateLimiter } from "../ports/rate-limiter";
import { RateLimitedError } from "../shared/errors";

export const PICKUP_CHANGE_LIMIT = 20;
export const PICKUP_CHANGE_WINDOW_SEC = 15 * 60;

export function pickupChangeKey(userId: string) {
  return `pickup-change:${userId}`;
}

export async function reservePickupChange(
  limiter: RateLimiter,
  userId: string,
) {
  const reservation = await limiter.reserve([
    {
      key: pickupChangeKey(userId),
      limit: PICKUP_CHANGE_LIMIT,
      windowSec: PICKUP_CHANGE_WINDOW_SEC,
    },
  ]);
  if (!reservation) {
    const error = new RateLimitedError();
    error.message =
      "Слишком много действий с записью. Подождите 15 минут и попробуйте снова.";
    throw error;
  }
  // Parsed attempts, including retries and conflicts, consume the shared quota.
  await reservation.commitFailure();
}
