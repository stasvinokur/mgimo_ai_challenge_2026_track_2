export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
export const LOGIN_LIMITS = { pair: 5, ip: 20, login: 50 } as const;
export const LOGIN_WINDOW_SEC = 15 * 60;

export function sessionExpiry(now: Date, createdAt: Date = now): Date {
  return new Date(
    Math.min(
      now.getTime() + SESSION_TTL_MS,
      createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS,
    ),
  );
}
