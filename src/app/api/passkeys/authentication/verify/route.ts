import { cookies } from "next/headers";
import { establishLogin } from "@/app/(auth)/session";
import { identity } from "@/composition/container";
import {
  json,
  passkeyLoginFailure,
  readPasskeyBody,
  requirePasskeyOrigin,
  takeChallenge,
} from "../../http";

export async function POST(request: Request) {
  try {
    requirePasskeyOrigin(request);
    const challengeId = await takeChallenge("authentication");
    // Invalid HTTP bodies still reach the application's IP attempt limiter.
    const body = await readPasskeyBody(request).catch(
      (): Record<string, unknown> => ({}),
    );
    const { next, ...input } = body;
    const result = await identity.passkeys.authenticate(
      {
        ...input,
        challengeId,
        ip: identity.getClientIp(request.headers.get("x-forwarded-for")),
      },
      (await cookies()).get(identity.sessionCookie.name)?.value,
    );
    return json({ destination: await establishLogin(result, next) });
  } catch {
    return passkeyLoginFailure();
  }
}
