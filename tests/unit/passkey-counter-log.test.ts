import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { expect, it, vi } from "vitest";
import type { PasskeyAuthenticationResponse } from "@/application/ports/passkey-verifier";
import { SimpleWebAuthnPasskeyVerifier } from "@/infrastructure/auth/passkey-verifier";

const origin = "https://passkey.example.invalid";
const rpId = "passkey.example.invalid";
const challenge = "passkey-counter-test-challenge";
const hash = (input: string | Buffer) =>
  createHash("sha256").update(input).digest();

function setup() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]);
  const id = randomBytes(32).toString("base64url");
  const credential = {
    id,
    publicKey: cose.toString("base64url"),
    counter: 7,
    transports: ["internal"],
  };
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const verifier = new SimpleWebAuthnPasskeyVerifier(origin, logger);

  function assertion(
    counter: number,
    options: {
      origin?: string;
      rpId?: string;
      challenge?: string;
      flags?: number;
    } = {},
  ): PasskeyAuthenticationResponse {
    const clientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        origin: options.origin ?? origin,
        challenge: options.challenge ?? challenge,
        crossOrigin: false,
      }),
    );
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    const authenticatorData = Buffer.concat([
      hash(options.rpId ?? rpId),
      Buffer.from([options.flags ?? 5]),
      count,
    ]);
    return {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: sign(
          "sha256",
          Buffer.concat([authenticatorData, hash(clientData)]),
          privateKey,
        ).toString("base64url"),
      },
    };
  }

  return {
    verifier,
    logger,
    credential,
    assertion,
    expectedChallengeHash: hash(challenge).toString("hex"),
  };
}

it.each([
  [7, 6],
  [7, 7],
  [7, 0],
  [1, 0],
  [0xffff_ffff, 0xffff_fffe],
  [0xffff_ffff, 0xffff_ffff],
])(
  "подписанный счётчик %i → %i отвергается и пишет только фиксированный код",
  async (stored, received) => {
    const d = setup();
    const input = {
      credential: { ...d.credential, counter: stored },
      response: d.assertion(received),
      expectedChallengeHash: d.expectedChallengeHash,
    };
    expect(await d.verifier.verifyAuthentication(input)).toEqual({
      verified: false,
    });
    expect(d.logger.warn.mock.calls).toEqual([
      ["passkey_counter_regression", { code: "PASSKEY_COUNTER_REGRESSION" }],
    ]);
    expect(d.logger.info).not.toHaveBeenCalled();
    expect(d.logger.error).not.toHaveBeenCalled();
    expect(JSON.stringify(d.logger.warn.mock.calls)).not.toContain(
      d.credential.id,
    );
    // Logging never turns the original library rejection into acceptance.
    expect(
      await new SimpleWebAuthnPasskeyVerifier(origin).verifyAuthentication(
        input,
      ),
    ).toEqual({ verified: false });
  },
);

it.each([
  [0, 0],
  [0, 1],
  [7, 8],
  [0xffff_fffe, 0xffff_ffff],
])(
  "счётчик %i → %i остаётся допустимым без кода регрессии",
  async (stored, received) => {
    const d = setup();
    expect(
      await d.verifier.verifyAuthentication({
        credential: { ...d.credential, counter: stored },
        response: d.assertion(received),
        expectedChallengeHash: d.expectedChallengeHash,
      }),
    ).toEqual({
      verified: true,
      credentialId: d.credential.id,
      newCounter: received,
    });
    expect(d.logger.warn).not.toHaveBeenCalled();
  },
);

it("поддельная подпись со счётчиком назад не выдаёт свидетельство клонирования в лог", async () => {
  const d = setup();
  const response = d.assertion(0);
  response.response.signature = randomBytes(64).toString("base64url");
  expect(
    await d.verifier.verifyAuthentication({
      credential: d.credential,
      response,
      expectedChallengeHash: d.expectedChallengeHash,
    }),
  ).toEqual({ verified: false });
  expect(d.logger.warn).not.toHaveBeenCalled();
});

it("неверные Origin, RP, challenge, UV, UP, id и публичный ключ остаются отказами без кода регрессии", async () => {
  const d = setup();
  for (const input of [
    { response: d.assertion(0, { origin: "https://other.example.invalid" }) },
    { response: d.assertion(0, { rpId: "other.example.invalid" }) },
    { response: d.assertion(0, { challenge: "other-test-challenge" }) },
    { response: d.assertion(0, { flags: 1 }) },
    { response: d.assertion(0, { flags: 4 }) },
    { response: { ...d.assertion(0), id: "other-test-credential" } },
    { response: { ...d.assertion(0), rawId: "other-test-credential" } },
    { response: d.assertion(0), expectedChallengeHash: "f".repeat(64) },
    { response: d.assertion(0), expectedChallengeHash: "invalid-test-hash" },
    {
      response: d.assertion(0),
      credential: { ...d.credential, publicKey: "invalid-test-public-key" },
    },
  ]) {
    expect(
      await d.verifier.verifyAuthentication({
        credential: d.credential,
        expectedChallengeHash: d.expectedChallengeHash,
        ...input,
      }),
    ).toEqual({ verified: false });
  }
  expect(d.logger.warn).not.toHaveBeenCalled();
});
