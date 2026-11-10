import type { RateLimiter } from "../ports/rate-limiter";
import { RateLimitedError } from "../shared/errors";
import type { AttendanceTokens } from "./qr-ports";

const limits = { mark: 10, issue: 20, close: 10 } as const;
export async function reserveAttendanceLimit(
  limiter: RateLimiter,
  action: keyof typeof limits,
  userId: string,
  ip: string,
  tokens: Pick<AttendanceTokens, "hash">,
) {
  const limit = limits[action];
  const reservation = await limiter.reserve([
    {
      key: `attendance:${action}:${userId}:${tokens.hash(ip)}`,
      limit,
      windowSec: 60,
    },
    { key: `attendance:${action}:${userId}`, limit: limit * 10, windowSec: 60 },
  ]);
  if (!reservation) throw new RateLimitedError();
  await reservation.commitFailure();
}
