import { cookies } from "next/headers";
import { identity } from "@/composition/container";
import {
  json,
  mapPasskeyRegistrationError,
  requirePasskeyActor,
  requirePasskeyOrigin,
  setChallenge,
} from "../../http";

export async function POST(request: Request) {
  try {
    const actor = await requirePasskeyActor();
    requirePasskeyOrigin(request);
    const result = await identity.passkeys.registrationOptions(
      actor,
      (await cookies()).get(identity.sessionCookie.name)?.value,
    );
    await setChallenge("registration", result.challengeId);
    return json(result.options);
  } catch (error) {
    return mapPasskeyRegistrationError(error);
  }
}
