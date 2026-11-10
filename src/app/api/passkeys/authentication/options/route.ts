import { identity } from "@/composition/container";
import {
  json,
  passkeyLoginFailure,
  requirePasskeyOrigin,
  setChallenge,
} from "../../http";

export async function POST(request: Request) {
  try {
    requirePasskeyOrigin(request);
    const result = await identity.passkeys.authenticationOptions({
      ip: identity.getClientIp(request.headers.get("x-forwarded-for")),
    });
    await setChallenge("authentication", result.challengeId);
    return json(result.options);
  } catch {
    return passkeyLoginFailure();
  }
}
