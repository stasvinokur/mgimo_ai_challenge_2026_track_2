import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { expect, it } from "vitest";
import type {
  PasskeyAuthenticationResponse,
  PasskeyRegistrationResponse,
} from "@/application/ports/passkey-verifier";
import { SimpleWebAuthnPasskeyVerifier } from "@/infrastructure/auth/passkey-verifier";

const origin = "https://pulse.example.invalid:8443";
const rpId = "pulse.example.invalid";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest();

function authenticator() {
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
  return {
    privateKey,
    cose,
    credential: {
      id,
      publicKey: cose.toString("base64url"),
      counter: 0,
      transports: ["internal"],
    },
  };
}

function authentication(
  device: ReturnType<typeof authenticator>,
  challenge: string,
  options: {
    counter?: number;
    verified?: boolean;
    origin?: string;
    rpId?: string;
  } = {},
): PasskeyAuthenticationResponse {
  const data = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge,
      origin: options.origin ?? origin,
      crossOrigin: false,
    }),
  );
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(options.counter ?? 1);
  const authenticatorData = Buffer.concat([
    hash(options.rpId ?? rpId),
    Buffer.from([options.verified === false ? 1 : 5]),
    counter,
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, hash(data)]),
    device.privateKey,
  );
  return {
    id: device.credential.id,
    rawId: device.credential.id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: data.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url"),
    },
  };
}

function registration(
  device: ReturnType<typeof authenticator>,
  challenge: string,
  verified = true,
): PasskeyRegistrationResponse {
  const data = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
      origin,
      crossOrigin: false,
    }),
  );
  const credentialId = Buffer.from(device.credential.id, "base64url");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    hash(rpId),
    Buffer.from([verified ? 0x45 : 0x41]),
    Buffer.alloc(4 + 16),
    length,
    credentialId,
    device.cose,
  ]);
  // Minimal CBOR attestation with fmt=none; the actual verifier decodes it.
  const attestation = Buffer.concat([
    Buffer.from([0xa3, 0x63]),
    Buffer.from("fmt"),
    Buffer.from([0x64]),
    Buffer.from("none"),
    Buffer.from([0x67]),
    Buffer.from("attStmt"),
    Buffer.from([0xa0, 0x68]),
    Buffer.from("authData"),
    Buffer.from([0x58, authData.length]),
    authData,
  ]);
  return {
    id: device.credential.id,
    rawId: device.credential.id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: data.toString("base64url"),
      attestationObject: attestation.toString("base64url"),
      transports: ["internal"],
    },
  };
}

it("выводит RP ID из APP_ORIGIN без порта и требует user verification в обоих типах опций", async () => {
  const verifier = new SimpleWebAuthnPasskeyVerifier(origin);
  const device = authenticator();
  const create = await verifier.registrationOptions({
    userId: "test-user",
    userName: "Тестовый пользователь",
    existingCredentials: [device.credential],
  });
  expect(create.rp).toEqual({ id: rpId, name: "Пульс" });
  expect(create.authenticatorSelection).toEqual({
    residentKey: "required",
    userVerification: "required",
  });
  expect(create.excludeCredentials).toEqual([
    expect.objectContaining({ id: device.credential.id, type: "public-key" }),
  ]);
  expect(Buffer.from(create.user.id, "base64url").toString()).toBe("test-user");
  const get = await verifier.authenticationOptions({
    credentials: [device.credential],
  });
  expect(get.rpId).toBe(rpId);
  expect(get.userVerification).toBe("required");
  expect(get.timeout).toBe(300_000);
  expect(get.challenge).not.toBe(create.challenge);
  const discoverable = await verifier.authenticationOptions({
    credentials: [],
  });
  expect(discoverable.allowCredentials).toEqual([]);
});

it("localhost разрешён для локального HTTP", async () => {
  const verifier = new SimpleWebAuthnPasskeyVerifier("http://localhost:3139");
  expect((await verifier.authenticationOptions({ credentials: [] })).rpId).toBe(
    "localhost",
  );
});

it.each([
  "http://127.0.0.1:3139",
  "https://192.0.2.1",
  "https://[::1]:3139",
  "https://[2001:db8::1]",
  "http://2130706433",
  "http://0x7f000001",
])("явно отказывает для RP ID IP-адреса %s", (url) => {
  expect(() => new SimpleWebAuthnPasskeyVerifier(url)).toThrow(
    "Локально используйте localhost вместо IP-адреса",
  );
});

it.each([
  "http://pulse.example.invalid",
  `${origin}/path`,
  `${origin}/?query=x`,
  `https://user:password@pulse.example.invalid`,
])("отклоняет неподходящий origin %s", (url) => {
  expect(() => new SimpleWebAuthnPasskeyVerifier(url)).toThrow(
    "Проверьте APP_ORIGIN",
  );
});

it("проверяет регистрацию реального тестового ключа и возвращает публичный COSE ключ", async () => {
  const verifier = new SimpleWebAuthnPasskeyVerifier(origin);
  const device = authenticator();
  const options = await verifier.registrationOptions({
    userId: "test-user",
    userName: "Тест",
    existingCredentials: [],
  });
  const input = {
    response: registration(device, options.challenge),
    expectedChallengeHash: hash(options.challenge).toString("hex"),
  };
  expect(await verifier.verifyRegistration(input)).toEqual({
    verified: true,
    credential: device.credential,
  });
  expect(
    await verifier.verifyRegistration({
      ...input,
      expectedChallengeHash: "0".repeat(64),
    }),
  ).toEqual({ verified: false });
  expect(
    await verifier.verifyRegistration({
      ...input,
      response: registration(device, options.challenge, false),
    }),
  ).toEqual({ verified: false });
});

it("проверяет подпись и счётчик ключа, отклоняет повтор и отсутствие user verification", async () => {
  const verifier = new SimpleWebAuthnPasskeyVerifier(origin);
  const device = authenticator();
  const options = await verifier.authenticationOptions({
    credentials: [device.credential],
  });
  const input = {
    response: authentication(device, options.challenge),
    expectedChallengeHash: hash(options.challenge).toString("hex"),
    credential: device.credential,
  };
  expect(await verifier.verifyAuthentication(input)).toEqual({
    verified: true,
    credentialId: device.credential.id,
    newCounter: 1,
  });
  expect(
    await verifier.verifyAuthentication({
      ...input,
      credential: { ...device.credential, counter: 1 },
    }),
  ).toEqual({ verified: false });
  expect(
    await verifier.verifyAuthentication({
      ...input,
      response: authentication(device, options.challenge, { verified: false }),
    }),
  ).toEqual({ verified: false });
  const zero = await verifier.verifyAuthentication({
    ...input,
    response: authentication(device, options.challenge, { counter: 0 }),
  });
  expect(zero).toEqual({
    verified: true,
    credentialId: device.credential.id,
    newCounter: 0,
  });
});

it("отклоняет чужой origin/RP ID, неверный challenge, id и подпись", async () => {
  const verifier = new SimpleWebAuthnPasskeyVerifier(origin);
  const device = authenticator();
  const options = await verifier.authenticationOptions({
    credentials: [device.credential],
  });
  const input = {
    response: authentication(device, options.challenge),
    expectedChallengeHash: hash(options.challenge).toString("hex"),
    credential: device.credential,
  };
  for (const response of [
    authentication(device, options.challenge, {
      origin: "https://other.example.invalid",
    }),
    authentication(device, options.challenge, {
      rpId: "other.example.invalid",
    }),
    authentication(device, "other-challenge"),
    { ...input.response, id: "other-credential" },
    {
      ...input.response,
      response: {
        ...input.response.response,
        signature: randomBytes(64).toString("base64url"),
      },
    },
  ]) {
    expect(await verifier.verifyAuthentication({ ...input, response })).toEqual(
      { verified: false },
    );
  }
  expect(
    await verifier.verifyAuthentication({
      ...input,
      expectedChallengeHash: "invalid",
    }),
  ).toEqual({ verified: false });
});
