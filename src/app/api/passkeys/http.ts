import { cookies } from "next/headers";
import { getActor, requireStaff, requireStudent } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import {
  PASSKEY_LIMIT_REACHED,
  PASSKEY_REAUTHENTICATION_REQUIRED,
  PasskeyLimitError,
  PasskeyReauthenticationRequiredError,
} from "@/application/identity/passkey-errors";
import { PASSKEY_LOGIN_MESSAGE } from "@/application/identity/passkeys";
import { ForbiddenError, ValidationError } from "@/application/shared/errors";
import { identity, system } from "@/composition/container";
import { appStorageName } from "@/ui/shared/app-path.mjs";

export const passkeyHeaders = { "Cache-Control": "private, no-store" };

export function json(data: unknown) {
  return Response.json(data, { headers: passkeyHeaders });
}

export function mapPasskeyRegistrationError(error: unknown) {
  if (
    error instanceof PasskeyReauthenticationRequiredError ||
    error instanceof PasskeyLimitError
  )
    return Response.json(
      {
        error: {
          code:
            error instanceof PasskeyReauthenticationRequiredError
              ? PASSKEY_REAUTHENTICATION_REQUIRED
              : PASSKEY_LIMIT_REACHED,
          message: error.message,
        },
      },
      {
        status:
          error instanceof PasskeyReauthenticationRequiredError ? 403 : 409,
        headers: passkeyHeaders,
      },
    );
  return mapRouteError(error);
}

export function requirePasskeyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin === "null" ||
    origin !== new URL(identity.getAppOrigin()).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ForbiddenError();
}

export async function requirePasskeyActor() {
  const actor = await getActor();
  if (actor?.kind === "student") return requireStudent();
  if (actor?.kind === "staff") return requireStaff();
  throw new ForbiddenError();
}

const challengeCookies = {
  registration: appStorageName("__Host-passkey-registration"),
  authentication: appStorageName("__Host-passkey-authentication"),
} as const;

export async function setChallenge(
  purpose: keyof typeof challengeCookies,
  id: string,
) {
  (await cookies()).set(challengeCookies[purpose], id, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 300,
  });
}

export async function takeChallenge(purpose: keyof typeof challengeCookies) {
  const jar = await cookies();
  const id = jar.get(challengeCookies[purpose])?.value;
  jar.set(challengeCookies[purpose], "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return id;
}

export function passkeyLoginFailure() {
  system.logger.warn("passkey_http_failed", { code: "PASSKEY_LOGIN_FAILED" });
  return Response.json(
    { error: { code: "PASSKEY_LOGIN_FAILED", message: PASSKEY_LOGIN_MESSAGE } },
    { status: 400, headers: passkeyHeaders },
  );
}

export async function readPasskeyBody(request: Request) {
  const invalid = () =>
    new ValidationError({ passkey: ["Повторите попытку."] });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(invalid()), 5000);
  });
  let text = "";
  let size = 0;
  let complete = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), expired]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65_536) throw invalid();
      text += decoder.decode(part.value, { stream: true });
    }
    complete = true;
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalid();
    return value as Record<string, unknown>;
  } catch {
    throw invalid();
  } finally {
    clearTimeout(timer);
    if (!complete)
      await reader.cancel().catch(() => {
        system.logger.warn("passkey_body_cancel_failed", {
          code: "PASSKEY_BODY_CANCEL_FAILED",
        });
      });
    reader.releaseLock();
  }
}
