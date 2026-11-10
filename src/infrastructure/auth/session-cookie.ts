export const SESSION_COOKIE = "__Host-pulse-session";

export function sessionCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(expiresAt),
  };
}
