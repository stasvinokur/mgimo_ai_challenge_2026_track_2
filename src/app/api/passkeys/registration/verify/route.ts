import { cookies } from "next/headers";
import { identity } from "@/composition/container";
import {
  json,
  mapPasskeyRegistrationError,
  readPasskeyBody,
  requirePasskeyActor,
  requirePasskeyOrigin,
  takeChallenge,
} from "../../http";

export async function POST(request: Request) {
  try {
    const actor = await requirePasskeyActor();
    requirePasskeyOrigin(request);
    const challengeId = await takeChallenge("registration");
    const body = await readPasskeyBody(request);
    await identity.passkeys.register(
      actor,
      {
        ...body,
        challengeId,
        ip: identity.getClientIp(request.headers.get("x-forwarded-for")),
      },
      (await cookies()).get(identity.sessionCookie.name)?.value,
    );
    return json({ ok: true });
  } catch (error) {
    return mapPasskeyRegistrationError(error);
  }
}
