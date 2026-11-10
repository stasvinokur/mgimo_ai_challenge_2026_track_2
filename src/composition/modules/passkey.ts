import "server-only";
import type { PasskeyVerifier } from "@/application/ports/passkey-verifier";
import { SimpleWebAuthnPasskeyVerifier } from "@/infrastructure/auth/passkey-verifier";
import { getEnv } from "@/infrastructure/config/env";

export function createPasskeyVerifier(): PasskeyVerifier {
  return new SimpleWebAuthnPasskeyVerifier(getEnv("APP_ORIGIN"));
}
