import "server-only";
import { cookies } from "next/headers";
import { loginDestination } from "@/application/identity/schemas";
import type { Actor } from "@/application/ports/actor";
import { identity } from "@/composition/container";

export async function establishLogin(
  result: { token: string; expiresAt: string; kind: Actor["kind"] },
  next: unknown,
) {
  (await cookies()).set(
    identity.sessionCookie.name,
    result.token,
    identity.sessionCookie.options(result.expiresAt),
  );
  return loginDestination(result.kind, next);
}
