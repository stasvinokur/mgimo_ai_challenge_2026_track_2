import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Logger } from "@/application/ports/logger";
import type {
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationResult,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResult,
  PasskeyVerifier,
} from "@/application/ports/passkey-verifier";

const timeout = 300_000;

function challengeMatches(expectedHash: string) {
  return (challenge: string) => {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
    const actual = createHash("sha256").update(challenge).digest();
    return timingSafeEqual(actual, Buffer.from(expectedHash, "hex"));
  };
}

export class SimpleWebAuthnPasskeyVerifier implements PasskeyVerifier {
  private readonly origin: string;
  private readonly rpId: string;

  constructor(
    appOrigin: string,
    private readonly logger?: Logger,
  ) {
    const url = new URL(appOrigin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname)) {
      throw new Error(
        "Ключи доступа недоступны: APP_ORIGIN должен содержать доменное имя. Локально используйте localhost вместо IP-адреса.",
      );
    }
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && hostname === "localhost")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Проверьте APP_ORIGIN для ключей доступа.");
    }
    this.origin = url.origin;
    this.rpId = url.hostname;
  }

  async registrationOptions(
    input: Parameters<PasskeyVerifier["registrationOptions"]>[0],
  ): Promise<PasskeyRegistrationOptions> {
    const options = await generateRegistrationOptions({
      rpName: "Пульс",
      rpID: this.rpId,
      userID: new TextEncoder().encode(input.userId),
      userName: input.userName,
      userDisplayName: input.userName,
      excludeCredentials: input.existingCredentials,
      timeout,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    return {
      challenge: options.challenge,
      rp: { id: this.rpId, name: "Пульс" },
      user: options.user,
      pubKeyCredParams: options.pubKeyCredParams,
      timeout,
      attestation: "none",
      excludeCredentials: input.existingCredentials.map((credential) => ({
        ...credential,
        type: "public-key",
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    };
  }

  async authenticationOptions(
    input: Parameters<PasskeyVerifier["authenticationOptions"]>[0],
  ): Promise<PasskeyAuthenticationOptions> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials: input.credentials,
      timeout,
      userVerification: "required",
    });
    return {
      challenge: options.challenge,
      rpId: this.rpId,
      timeout,
      allowCredentials: input.credentials.map((credential) => ({
        ...credential,
        type: "public-key",
      })),
      userVerification: "required",
    };
  }

  async verifyRegistration(
    input: Parameters<PasskeyVerifier["verifyRegistration"]>[0],
  ): Promise<PasskeyRegistrationResult> {
    try {
      const result = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challengeMatches(input.expectedChallengeHash),
        expectedOrigin: this.origin,
        expectedRPID: this.rpId,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo.userVerified) {
        return { verified: false };
      }
      const credential = result.registrationInfo.credential;
      return {
        verified: true,
        credential: {
          id: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: credential.transports ?? [],
        },
      };
    } catch {
      return { verified: false };
    }
  }

  async verifyAuthentication(
    input: Parameters<PasskeyVerifier["verifyAuthentication"]>[0],
  ): Promise<PasskeyAuthenticationResult> {
    try {
      if (input.response.id !== input.credential.id) return { verified: false };
      const result = await this.verifyAssertion(input);
      if (!result.verified || !result.authenticationInfo.userVerified) {
        return { verified: false };
      }
      return {
        verified: true,
        credentialId: result.authenticationInfo.credentialID,
        newCounter: result.authenticationInfo.newCounter,
      };
    } catch (error) {
      if (
        this.logger &&
        error instanceof Error &&
        /^Response counter value (?:0|[1-9]\d*) was lower than expected (?:0|[1-9]\d*)$/.test(
          error.message,
        )
      ) {
        // The original counter rejection stands. Verify its signature before logging evidence.
        const proof = await this.verifyAssertion(input, 0).catch(() => null);
        const newCounter = proof?.authenticationInfo.newCounter;
        if (
          proof?.verified &&
          proof.authenticationInfo.userVerified &&
          newCounter !== undefined &&
          (newCounter > 0 || input.credential.counter > 0) &&
          newCounter <= input.credential.counter
        ) {
          this.logger.warn("passkey_counter_regression", {
            code: "PASSKEY_COUNTER_REGRESSION",
          });
        }
      }
      return { verified: false };
    }
  }

  private verifyAssertion(
    input: Parameters<PasskeyVerifier["verifyAuthentication"]>[0],
    counter = input.credential.counter,
  ) {
    return verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challengeMatches(input.expectedChallengeHash),
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      requireUserVerification: true,
      credential: {
        ...input.credential,
        counter,
        publicKey: new Uint8Array(
          Buffer.from(input.credential.publicKey, "base64url"),
        ),
      },
    });
  }
}
