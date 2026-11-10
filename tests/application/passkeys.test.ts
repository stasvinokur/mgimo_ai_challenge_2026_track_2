import { describe, expect, it, vi } from "vitest";
import { Login } from "@/application/identity/login";
import {
  PASSKEY_LIMIT_REACHED,
  PASSKEY_REAUTHENTICATION_REQUIRED,
  PasskeyLimitError,
  PasskeyReauthenticationRequiredError,
  PasskeyRegistrationRateLimitedError,
} from "@/application/identity/passkey-errors";
import type {
  PasskeyRecord,
  PasskeyRepository,
  WebauthnChallenge,
  WebauthnChallengePurpose,
} from "@/application/identity/passkey-ports";
import {
  PASSKEY_LOGIN_MESSAGE,
  Passkeys,
} from "@/application/identity/passkeys";
import type { Actor } from "@/application/ports/actor";
import type { IdGenerator } from "@/application/ports/id-generator";
import type {
  PasskeyAuthenticationResponse,
  PasskeyAuthenticationResult,
  PasskeyRegistrationResponse,
  PasskeyVerifier,
} from "@/application/ports/passkey-verifier";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  DEMO_PASSKEY_DEVICE_NAME,
  PASSKEY_AUTHENTICATION_UNKNOWN_ISSUANCE_LIMIT,
  PASSKEY_ISSUANCE_WINDOW_SEC,
  PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
  PASSKEY_REGISTRATION_SUCCESS_LIMIT,
  PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC,
} from "@/domain/identity/passkey-policy";
import { FakeClock } from "../fakes/clock";
import {
  anna,
  FakeIdentityRepository,
  FakePasswords,
  FakeRateLimiter,
  FakeSessionStore,
  FakeTokens,
  marina,
  timur,
} from "../fakes/identity";

class PasskeyIds implements IdGenerator {
  private sequence = 0;
  next() {
    return `00000000-0000-7000-8000-${(++this.sequence).toString().padStart(12, "0")}`;
  }
}

class FakePasskeys implements PasskeyRepository {
  credentials = new Map<string, PasskeyRecord>();
  demoUsers = new Set<string>();
  challenges = new Map<string, WebauthnChallenge & { used: boolean }>();
  async isDemoAccount(userId: string) {
    return this.demoUsers.has(userId);
  }
  async listForUser(userId: string) {
    return structuredClone(
      [...this.credentials.values()].filter((key) => key.userId === userId),
    );
  }
  logins = new Map<string, string>([
    [anna.userId, "anna"],
    [timur.userId, "timur"],
    [marina.userId, "marina"],
  ]);
  async findLoginForUser(userId: string) {
    return this.logins.get(userId) ?? null;
  }
  async create(record: PasskeyRecord) {
    const existing = [...this.credentials.values()]
      .filter((key) => key.userId === record.userId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    if (existing.length >= 10 && !this.demoUsers.has(record.userId))
      return false;
    if (
      [...this.credentials.values()].some(
        (key) => key.credentialId === record.credentialId,
      )
    )
      throw new Error("duplicate");
    if (existing.length >= 10) {
      for (const key of existing.slice(0, existing.length - 9))
        this.credentials.delete(key.id);
    }
    this.credentials.set(record.id, structuredClone(record));
    return true;
  }
  async deleteForUser(id: string, userId: string) {
    return this.credentials.get(id)?.userId === userId
      ? this.credentials.delete(id)
      : false;
  }
  async findByCredentialId(credentialId: string) {
    return structuredClone(
      [...this.credentials.values()].find(
        (key) => key.credentialId === credentialId,
      ) ?? null,
    );
  }
  async updateCounter(
    id: string,
    userId: string,
    previousCounter: number,
    newCounter: number,
    usedAt: Date,
  ) {
    const record = this.credentials.get(id);
    if (
      !record ||
      record.userId !== userId ||
      record.counter !== previousCounter
    )
      return false;
    record.counter = newCounter;
    record.lastUsedAt = usedAt.toISOString();
    return true;
  }
  async createChallenge(challenge: WebauthnChallenge) {
    this.challenges.set(challenge.id, { ...challenge, used: false });
  }
  async consumeChallenge(
    id: string,
    purpose: WebauthnChallengePurpose,
    userId: string | null,
    now: Date,
  ) {
    const challenge = this.challenges.get(id);
    if (
      !challenge ||
      challenge.used ||
      challenge.purpose !== purpose ||
      challenge.userId !== userId ||
      new Date(challenge.expiresAt) <= now
    )
      return null;
    challenge.used = true;
    return structuredClone(challenge);
  }
}

function encoded(value: string) {
  return Buffer.from(value).toString("base64url");
}

const registration: PasskeyRegistrationResponse = {
  id: encoded("credential"),
  rawId: encoded("credential"),
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: encoded("client"),
    attestationObject: encoded("attest"),
  },
};
const authentication: PasskeyAuthenticationResponse = {
  id: registration.id,
  rawId: registration.id,
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: encoded("client"),
    authenticatorData: encoded("auth"),
    signature: encoded("signature"),
  },
};
const ip = "192.0.2.42";

function setup() {
  const repository = new FakePasskeys();
  const clock = new FakeClock("2026-11-05T10:00:00Z");
  const tokens = new FakeTokens();
  const users = new FakeIdentityRepository();
  const sessions = new FakeSessionStore();
  const limiter = new FakeRateLimiter(clock);
  const ids = new PasskeyIds();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let sequence = 0;
  const verifier = {
    registrationOptions: vi.fn<PasskeyVerifier["registrationOptions"]>(
      async ({ userId, userName, existingCredentials }) => ({
        challenge: `challenge-${++sequence}`,
        rp: { id: "localhost", name: "Пульс" },
        user: { id: userId, name: userName, displayName: userName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 300_000,
        attestation: "none",
        excludeCredentials: existingCredentials.map((key) => ({
          ...key,
          type: "public-key",
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      }),
    ),
    authenticationOptions: vi.fn<PasskeyVerifier["authenticationOptions"]>(
      async ({ credentials }) => ({
        challenge: `challenge-${++sequence}`,
        rpId: "localhost",
        timeout: 300_000,
        allowCredentials: credentials.map((key) => ({
          ...key,
          type: "public-key",
        })),
        userVerification: "required",
      }),
    ),
    verifyRegistration: vi.fn<PasskeyVerifier["verifyRegistration"]>(
      async () => ({
        verified: true,
        credential: {
          id: registration.id,
          publicKey: "test-public-key",
          counter: 0,
          transports: ["internal"],
        },
      }),
    ),
    verifyAuthentication: vi.fn<PasskeyVerifier["verifyAuthentication"]>(
      async ({ credential }) => ({
        verified: true,
        credentialId: credential.id,
        newCounter: credential.counter + 1,
      }),
    ),
  };
  const deps = {
    repository,
    verifier,
    users,
    sessions,
    limiter,
    tokens,
    clock,
    ids,
    logger,
  };
  const passkeys = new Passkeys(deps);
  const login = new Login({
    ...deps,
    passwords: new FakePasswords(),
    dummyHash: async () => "hash:dummy",
  });
  const registrationSessions = new Map<string, { token: string; id: string }>();
  function freshSession(actor: Actor = anna) {
    const existing = registrationSessions.get(actor.userId);
    if (existing) return existing.token;
    const token = tokens.generate();
    const id = ids.next();
    const now = clock.now().toISOString();
    sessions.records.set(id, {
      id,
      userId: actor.userId,
      tokenHash: tokens.hash(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(clock.now().getTime() + 7 * 86400_000).toISOString(),
    });
    registrationSessions.set(actor.userId, { token, id });
    return token;
  }
  function forgetFreshSession(actor: Actor = anna) {
    const session = registrationSessions.get(actor.userId);
    if (session) sessions.records.delete(session.id);
    registrationSessions.delete(actor.userId);
  }
  async function register(actor = anna) {
    const token = freshSession(actor);
    const { challengeId } = await passkeys.registrationOptions(actor, token);
    await passkeys.register(
      actor,
      {
        challengeId,
        ip,
        deviceName: "  Личный телефон  ",
        response: registration,
      },
      token,
    );
    const key = [...repository.credentials.values()].find(
      (key) => key.userId === actor.userId,
    );
    if (!key) throw new Error("Ключ не создан");
    forgetFreshSession(actor);
    return key;
  }
  async function assertion() {
    const { challengeId } = await passkeys.authenticationOptions({ ip });
    return { challengeId, ip, response: authentication };
  }
  return {
    ...deps,
    passkeys,
    login,
    register,
    assertion,
    freshSession,
    forgetFreshSession,
  };
}

it("регистрирует свой ключ, хранит хэш challenge и отдаёт только безопасный DTO", async () => {
  const d = setup();
  const key = await d.register();
  expect(key).toMatchObject({
    userId: anna.userId,
    deviceName: "Личный телефон",
  });
  expect([...d.repository.challenges.values()][0]).toMatchObject({
    userId: anna.userId,
    purpose: "registration",
    challengeHash: "digest:challenge-1",
    createdAt: "2026-11-05T10:00:00.000Z",
    expiresAt: "2026-11-05T10:05:00.000Z",
    used: true,
  });
  expect(await d.passkeys.list(anna)).toEqual([
    {
      id: key.id,
      deviceName: "Личный телефон",
      createdAt: "2026-11-05T10:00:00.000Z",
      lastUsedAt: null,
    },
  ]);
  const next = await d.passkeys.registrationOptions(anna, d.freshSession(anna));
  expect(next.options.excludeCredentials).toEqual([
    { id: key.credentialId, transports: ["internal"], type: "public-key" },
  ]);
  expect(await d.passkeys.list(timur)).toEqual([]);
});

it("принимает полный ответ browser 14 и передаёт verifier только контрактные поля", async () => {
  const d = setup();
  const { challengeId } = await d.passkeys.registrationOptions(
    anna,
    d.freshSession(anna),
  );
  const browserRegistration = {
    ...registration,
    authenticatorAttachment: "platform",
    response: {
      ...registration.response,
      transports: ["internal"],
      publicKeyAlgorithm: -7,
      publicKey: encoded("public-key"),
      authenticatorData: encoded("authenticator-data"),
    },
  };
  await d.passkeys.register(
    anna,
    {
      challengeId,
      ip,
      deviceName: "Телефон",
      response: browserRegistration,
    },
    d.freshSession(anna),
  );
  expect(d.verifier.verifyRegistration).toHaveBeenCalledExactlyOnceWith({
    expectedChallengeHash: "digest:challenge-1",
    response: {
      ...registration,
      authenticatorAttachment: "platform",
      response: { ...registration.response, transports: ["internal"] },
    },
  });
  expect(await d.passkeys.list(anna)).toHaveLength(1);
});

it.each([
  { publicKeyAlgorithm: -7.5 },
  { publicKeyAlgorithm: 2147483648 },
  { publicKey: "A".repeat(8193) },
  { publicKey: "invalid=" },
  { authenticatorData: "A".repeat(8193) },
  { authenticatorData: "invalid=" },
  { unexpected: true },
])("проверяет границы дополнительных полей browser 14", async (extra) => {
  const d = setup();
  const { challengeId } = await d.passkeys.registrationOptions(
    anna,
    d.freshSession(anna),
  );
  await expect(
    d.passkeys.register(
      anna,
      {
        challengeId,
        ip,
        deviceName: "Телефон",
        response: {
          ...registration,
          response: { ...registration.response, ...extra },
        },
      },
      d.freshSession(anna),
    ),
  ).rejects.toThrow(ValidationError);
  expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
});

it("получение и удаление чужого ключа неотличимо от несуществующего", async () => {
  const d = setup();
  const key = await d.register();
  for (const id of [key.id, d.ids.next(), "bad-id"]) {
    await expect(d.passkeys.get(timur, id)).rejects.toThrow(NotFoundError);
    await expect(d.passkeys.remove(timur, id)).rejects.toThrow(NotFoundError);
  }
  expect(await d.passkeys.get(anna, key.id)).toHaveProperty("id", key.id);
  await d.passkeys.remove(anna, key.id);
  expect(await d.passkeys.list(anna)).toEqual([]);
});

it.each([anna, marina])(
  "демо-пользователь $kind не удаляет существующий ключ и получает тот же 404, что у отсутствующего",
  async (actor) => {
    const d = setup();
    d.repository.demoUsers.add(actor.userId);
    const key = await d.register(actor);
    const remove = vi.spyOn(d.repository, "deleteForUser");
    for (const id of [key.id, d.ids.next(), "invalid"])
      await expect(d.passkeys.remove(actor, id)).rejects.toThrow(NotFoundError);
    expect(remove).not.toHaveBeenCalled();
    expect(await d.passkeys.get(actor, key.id)).toHaveProperty("id", key.id);
    await expect(
      d.passkeys.authenticate(await d.assertion()),
    ).resolves.toHaveProperty("kind", actor.kind);
  },
);

it("list и get скрывают старое произвольное имя демо-ключа на сервере, сохраняя 404 чужого владельца", async () => {
  const d = setup();
  const key = await d.register();
  key.deviceName = "Текст прежнего посетителя";
  d.repository.credentials.set(key.id, key);
  expect(await d.passkeys.list(anna)).toEqual([
    expect.objectContaining({ deviceName: key.deviceName }),
  ]);
  expect(await d.passkeys.get(anna, key.id)).toHaveProperty(
    "deviceName",
    key.deviceName,
  );
  d.repository.demoUsers.add(anna.userId);
  d.repository.demoUsers.add(timur.userId);
  expect(await d.passkeys.list(anna)).toEqual([
    expect.objectContaining({ deviceName: DEMO_PASSKEY_DEVICE_NAME }),
  ]);
  expect(await d.passkeys.get(anna, key.id)).toHaveProperty(
    "deviceName",
    DEMO_PASSKEY_DEVICE_NAME,
  );
  expect(JSON.stringify(await d.passkeys.list(anna))).not.toContain(
    key.deviceName,
  );
  expect(d.repository.credentials.get(key.id)?.deviceName).toBe(key.deviceName);
  expect(await d.passkeys.list(timur)).toEqual([]);
  for (const id of [key.id, d.ids.next()])
    await expect(d.passkeys.get(timur, id)).rejects.toThrow(NotFoundError);
});

it("сотрудник управляет своими ключами и входит с ролью сотрудника", async () => {
  const d = setup();
  const key = await d.register(marina);
  const session = await d.passkeys.authenticate(await d.assertion());
  expect(session.kind).toBe("staff");
  expect(await d.passkeys.list(marina)).toEqual([
    expect.objectContaining({
      id: key.id,
      lastUsedAt: d.clock.now().toISOString(),
    }),
  ]);
  await d.passkeys.remove(marina, key.id);
});

it("в use cases проверяется роль, переданный клиентом владелец не принимается", async () => {
  const d = setup();
  const teacher = {
    kind: "teacher" as const,
    userId: "teacher",
    teacherId: "t",
  };
  await expect(d.passkeys.list(teacher)).rejects.toThrow(ForbiddenError);
  await expect(d.passkeys.get(teacher, d.ids.next())).rejects.toThrow(
    ForbiddenError,
  );
  await expect(d.passkeys.remove(teacher, d.ids.next())).rejects.toThrow(
    ForbiddenError,
  );
  await expect(
    d.passkeys.registrationOptions(teacher, d.freshSession(teacher)),
  ).rejects.toThrow(ForbiddenError);
  await expect(
    d.passkeys.register(teacher, {}, d.freshSession(teacher)),
  ).rejects.toThrow(ForbiddenError);
  const { challengeId } = await d.passkeys.registrationOptions(
    anna,
    d.freshSession(anna),
  );
  await expect(
    d.passkeys.register(
      anna,
      {
        challengeId,
        ip,
        deviceName: "Телефон",
        response: registration,
        userId: timur.userId,
      },
      d.freshSession(anna),
    ),
  ).rejects.toThrow(ValidationError);
});

it("challenge регистрации привязан к владельцу и purpose, попытка чужого пользователя его не расходует", async () => {
  const d = setup();
  const { challengeId } = await d.passkeys.registrationOptions(
    anna,
    d.freshSession(anna),
  );
  const data = {
    challengeId,
    ip,
    deviceName: "Телефон",
    response: registration,
  };
  await expect(
    d.passkeys.register(timur, data, d.freshSession(timur)),
  ).rejects.toThrow(ValidationError);
  expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
  expect(d.repository.challenges.get(challengeId)?.used).toBe(false);
  const { challengeId: authId } = await d.passkeys.authenticationOptions({
    ip,
  });
  await expect(
    d.passkeys.register(
      anna,
      { ...data, challengeId: authId },
      d.freshSession(anna),
    ),
  ).rejects.toThrow(ValidationError);
  await d.passkeys.register(anna, data, d.freshSession(anna));
  await expect(
    d.passkeys.register(anna, data, d.freshSession(anna)),
  ).rejects.toThrow(ValidationError);
  expect(d.verifier.verifyRegistration).toHaveBeenCalledTimes(1);
});

it("challenge регистрации истекает ровно через пять минут", async () => {
  const d = setup();
  const { challengeId } = await d.passkeys.registrationOptions(
    anna,
    d.freshSession(anna),
  );
  d.clock.advance(300_000);
  await expect(
    d.passkeys.register(
      anna,
      {
        challengeId,
        ip,
        deviceName: "Телефон",
        response: registration,
      },
      d.freshSession(anna),
    ),
  ).rejects.toThrow(ValidationError);
  expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
});

it("повтор одного authentication challenge создаёт ровно одну сессию, включая параллельные запросы", async () => {
  const d = setup();
  await d.register();
  const assertion = await d.assertion();
  const results = await Promise.allSettled([
    d.passkeys.authenticate(assertion),
    d.passkeys.authenticate(assertion),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(d.sessions.records.size).toBe(1);
  expect(d.verifier.verifyAuthentication).toHaveBeenCalledTimes(1);
  await expect(d.passkeys.authenticate(assertion)).rejects.toMatchObject({
    fieldErrors: { credentials: [PASSKEY_LOGIN_MESSAGE] },
  });
});

it("просрочка, неверный purpose и неуспех verifier расходуют challenge и не создают сессию", async () => {
  const d = setup();
  await d.register();
  const assertion = await d.assertion();
  d.clock.advance(300_000);
  await expect(d.passkeys.authenticate(assertion)).rejects.toThrow(
    ValidationError,
  );
  const registration = await d.passkeys.registrationOptions(
    anna,
    d.freshSession(anna),
  );
  await expect(
    d.passkeys.authenticate({
      ...assertion,
      challengeId: registration.challengeId,
    }),
  ).rejects.toThrow(ValidationError);
  d.forgetFreshSession(anna);
  const fresh = await d.assertion();
  d.verifier.verifyAuthentication.mockResolvedValueOnce({ verified: false });
  await expect(d.passkeys.authenticate(fresh)).rejects.toThrow(ValidationError);
  expect(d.repository.challenges.get(fresh.challengeId)?.used).toBe(true);
  expect(d.sessions.records.size).toBe(0);
});

it.each([0, 7, 6, -1, 1.5, 0x1_0000_0000])(
  "отклоняет счётчик %s при сохранённом 7",
  async (newCounter) => {
    const d = setup();
    const key = await d.register();
    key.counter = 7;
    d.verifier.verifyAuthentication.mockResolvedValueOnce({
      verified: true,
      credentialId: key.credentialId,
      newCounter,
    });
    await expect(d.passkeys.authenticate(await d.assertion())).rejects.toThrow(
      ValidationError,
    );
    expect(d.sessions.records.size).toBe(0);
    expect(key.counter).toBe(7);
  },
);

it("аутентификатор без счётчика допускается только для пары 0 → 0", async () => {
  const d = setup();
  const key = await d.register();
  d.verifier.verifyAuthentication.mockResolvedValueOnce({
    verified: true,
    credentialId: key.credentialId,
    newCounter: 0,
  });
  await d.passkeys.authenticate(await d.assertion());
  expect(key.counter).toBe(0);
  expect(key.lastUsedAt).toBe(d.clock.now().toISOString());
});

it("два валидных challenge с одинаковым новым счётчиком проходят CAS только один раз", async () => {
  const d = setup();
  await d.register();
  const assertions = [await d.assertion(), await d.assertion()];
  const ready: ((result: PasskeyAuthenticationResult) => void)[] = [];
  d.verifier.verifyAuthentication.mockImplementation(
    () => new Promise((resolve) => ready.push(resolve)),
  );
  const promises = assertions.map((assertion) =>
    d.passkeys.authenticate(assertion),
  );
  await vi.waitFor(() => expect(ready).toHaveLength(2));
  for (const resolve of ready)
    resolve({ verified: true, credentialId: registration.id, newCounter: 1 });
  const results = await Promise.allSettled(promises);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(d.sessions.records.size).toBe(1);
});

it("удаление ключа во время проверки не допускает последующего входа", async () => {
  const d = setup();
  const key = await d.register();
  d.verifier.verifyAuthentication.mockImplementationOnce(async () => {
    await d.passkeys.remove(anna, key.id);
    return { verified: true, credentialId: key.credentialId, newCounter: 1 };
  });
  await expect(d.passkeys.authenticate(await d.assertion())).rejects.toThrow(
    ValidationError,
  );
  expect(d.sessions.records.size).toBe(0);
});

it("20 ошибок, включая повреждённый запрос, блокируют общий парольный IP до verifier", async () => {
  const d = setup();
  await d.register();
  for (let index = 0; index < 20; index++)
    await expect(d.passkeys.authenticate({ ip })).rejects.toMatchObject({
      fieldErrors: { credentials: [PASSKEY_LOGIN_MESSAGE] },
    });
  await expect(d.passkeys.authenticate(await d.assertion())).rejects.toThrow(
    ValidationError,
  );
  expect(d.verifier.verifyAuthentication).not.toHaveBeenCalled();
  await expect(
    d.login.execute({ login: "anna", password: "anna-password", ip }),
  ).rejects.toThrow(RateLimitedError);
  d.clock.advance(15 * 60 * 1000);
  await expect(
    d.passkeys.authenticate(await d.assertion()),
  ).resolves.toMatchObject({ kind: "student" });
});

it("30 выдач options не создают неудачных входов и не раскрывают аккаунты", async () => {
  const d = setup();
  for (let index = 0; index < 30; index++) {
    const result = await d.passkeys.authenticationOptions({ ip });
    expect(result.options.allowCredentials).toEqual([]);
    expect(result.options.userVerification).toBe("required");
  }
  expect(d.verifier.authenticationOptions).toHaveBeenCalledTimes(30);
  expect([...d.limiter.attempts.keys()]).toEqual([
    `passkey-challenge:authentication:ip:${d.tokens.hash(ip)}`,
  ]);
  expect([...d.limiter.attempts.values()][0]).toHaveLength(30);
  await expect(
    d.login.execute({ login: "anna", password: "anna-password", ip }),
  ).resolves.toMatchObject({ kind: "student" });
});

it("неизвестный ключ, повреждение, отказ verifier, чужой результат и внутренняя ошибка дают одну ошибку без деталей", async () => {
  const d = setup();
  await d.register();
  const cases = [
    async () => d.passkeys.authenticate({ ip }),
    async () =>
      d.passkeys.authenticate({
        ...(await d.assertion()),
        response: { ...authentication, id: encoded("unknown") },
      }),
    async () => {
      d.verifier.verifyAuthentication.mockResolvedValueOnce({
        verified: false,
      });
      return d.passkeys.authenticate(await d.assertion());
    },
    async () => {
      d.verifier.verifyAuthentication.mockResolvedValueOnce({
        verified: true,
        credentialId: "other-key",
        newCounter: 1,
      });
      return d.passkeys.authenticate(await d.assertion());
    },
    async () => {
      d.verifier.verifyAuthentication.mockRejectedValueOnce(
        new Error("secret credential id"),
      );
      return d.passkeys.authenticate(await d.assertion());
    },
  ];
  for (const run of cases)
    await expect(run()).rejects.toMatchObject({
      fieldErrors: { credentials: [PASSKEY_LOGIN_MESSAGE] },
    });
  expect(d.logger.warn.mock.calls).toEqual(
    Array.from({ length: cases.length }, () => [
      "passkey_login_failed",
      { code: "PASSKEY_LOGIN_FAILED" },
    ]),
  );
  expect(d.sessions.records.size).toBe(0);
});

it("password → passkey → password отзывают прежнюю cookie-сессию через общий помощник", async () => {
  const d = setup();
  await d.register();
  const passwordInput = { login: "anna", password: "anna-password", ip };
  const old = await d.login.execute(passwordInput);
  const passkey = await d.passkeys.authenticate(await d.assertion(), old.token);
  expect([...d.sessions.records.values()]).toEqual([
    expect.objectContaining({
      tokenHash: d.tokens.hash(passkey.token),
      expiresAt: "2026-11-12T10:00:00.000Z",
    }),
  ]);
  const password = await d.login.execute(passwordInput, passkey.token);
  expect([...d.sessions.records.values()]).toEqual([
    expect.objectContaining({ tokenHash: d.tokens.hash(password.token) }),
  ]);
});

it("ошибка отзыва прежней сессии отзывает новую и даёт общую ошибку входа", async () => {
  const d = setup();
  await d.register();
  const old = await d.login.execute({
    login: "anna",
    password: "anna-password",
    ip,
  });
  const oldSession = [...d.sessions.records.values()][0];
  vi.spyOn(d.sessions, "revoke").mockRejectedValueOnce(
    new Error("revoke failed"),
  );
  await expect(
    d.passkeys.authenticate(await d.assertion(), old.token),
  ).rejects.toMatchObject({
    fieldErrors: { credentials: [PASSKEY_LOGIN_MESSAGE] },
  });
  expect([...d.sessions.records.values()]).toEqual([oldSession]);
  expect(d.logger.info).toHaveBeenCalledTimes(1);
});

describe("имя устройства", () => {
  it.each([
    "Чужой текст посетителя",
    "",
    "x".repeat(65),
    "Телефон\u0000",
    null,
    42,
    undefined,
  ])(
    "демо-аккаунт получает серверное имя независимо от значения клиента: %j",
    async (deviceName) => {
      const d = setup();
      d.repository.demoUsers.add(anna.userId);
      const token = d.freshSession();
      const { challengeId } = await d.passkeys.registrationOptions(anna, token);
      await d.passkeys.register(
        anna,
        { challengeId, ip, deviceName, response: registration },
        token,
      );
      expect(await d.passkeys.list(anna)).toEqual([
        expect.objectContaining({ deviceName: DEMO_PASSKEY_DEVICE_NAME }),
      ]);
      expect(await d.passkeys.isDemoAccount(anna)).toBe(true);
      expect(await d.passkeys.isDemoAccount(timur)).toBe(false);
    },
  );

  it("демо-признак не позволяет подменять владельца и обходить свежий вход", async () => {
    const d = setup();
    d.repository.demoUsers.add(anna.userId);
    const token = d.freshSession();
    const { challengeId } = await d.passkeys.registrationOptions(anna, token);
    await expect(
      d.passkeys.register(
        anna,
        { challengeId, ip, response: registration, userId: timur.userId },
        token,
      ),
    ).rejects.toThrow(ValidationError);
    d.clock.advance(10 * 60_000 + 1);
    await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow(
      PasskeyReauthenticationRequiredError,
    );
    await expect(
      d.passkeys.register(
        anna,
        { challengeId, ip, response: registration },
        token,
      ),
    ).rejects.toThrow(PasskeyReauthenticationRequiredError);
    expect(d.repository.credentials.size).toBe(0);
    expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
  });

  it.each(["", " ", "x".repeat(65), "Телефон\u0000"])(
    "отклоняет недопустимое имя",
    async (deviceName) => {
      const d = setup();
      const { challengeId } = await d.passkeys.registrationOptions(
        anna,
        d.freshSession(anna),
      );
      await expect(
        d.passkeys.register(
          anna,
          {
            challengeId,
            ip,
            deviceName,
            response: registration,
          },
          d.freshSession(anna),
        ),
      ).rejects.toThrow(ValidationError);
      expect(d.repository.credentials.size).toBe(0);
      expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
    },
  );
});

it("ошибки повторного входа и лимита имеют стабильные коды и точные подсказки", () => {
  expect(PASSKEY_REAUTHENTICATION_REQUIRED).toBe(
    "PASSKEY_REAUTHENTICATION_REQUIRED",
  );
  expect(PASSKEY_LIMIT_REACHED).toBe("PASSKEY_LIMIT_REACHED");
  expect(new PasskeyReauthenticationRequiredError()).toBeInstanceOf(
    ForbiddenError,
  );
  expect(new PasskeyReauthenticationRequiredError().message).toBe(
    "Чтобы добавить ключ доступа, войдите заново",
  );
  expect(new PasskeyLimitError().message).toBe(
    "Можно добавить не больше 10 ключей доступа. Удалите ненужный ключ и попробуйте снова.",
  );
});

function registrationSession(d: ReturnType<typeof setup>, token: string) {
  const session = [...d.sessions.records.values()].find(
    (record) => record.tokenHash === d.tokens.hash(token),
  );
  if (!session) throw new Error("Тестовая сессия не найдена");
  return session;
}

const staleSessionCases = [
  "missing",
  "malformed",
  "unknown",
  "foreign",
  "future",
  "old",
  "expired",
  "revoked",
  "invalid-date",
] as const;
function invalidateSession(
  d: ReturnType<typeof setup>,
  token: string,
  reason: (typeof staleSessionCases)[number],
) {
  const session = registrationSession(d, token);
  switch (reason) {
    case "missing":
      return undefined;
    case "malformed":
      return "malformed";
    case "unknown":
      return d.tokens.generate();
    case "foreign":
      return d.freshSession(timur);
    case "future":
      session.createdAt = new Date(d.clock.now().getTime() + 1).toISOString();
      break;
    case "old":
      session.createdAt = new Date(
        d.clock.now().getTime() - 600_001,
      ).toISOString();
      break;
    case "expired":
      session.expiresAt = d.clock.now().toISOString();
      break;
    case "revoked":
      d.sessions.records.delete(session.id);
      break;
    case "invalid-date":
      session.createdAt = "invalid-date";
      break;
  }
  return token;
}

it.each(staleSessionCases)(
  "регистрация options требует свежую сессию: %s",
  async (reason) => {
    const d = setup();
    const token = invalidateSession(d, d.freshSession(), reason);
    await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow(
      PasskeyReauthenticationRequiredError,
    );
    expect(d.verifier.registrationOptions).not.toHaveBeenCalled();
    expect(d.repository.challenges.size).toBe(0);
    expect(d.limiter.attempts.size).toBe(0);
  },
);

it.each(staleSessionCases)(
  "подтверждение регистрации повторно проверяет сессию: %s",
  async (reason) => {
    const d = setup();
    const initial = d.freshSession();
    const { challengeId } = await d.passkeys.registrationOptions(anna, initial);
    const token = invalidateSession(d, initial, reason);
    await expect(
      d.passkeys.register(
        anna,
        { challengeId, ip, deviceName: "Телефон", response: registration },
        token,
      ),
    ).rejects.toThrow(PasskeyReauthenticationRequiredError);
    expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
    expect(d.repository.challenges.get(challengeId)?.used).toBe(false);
    expect(d.repository.credentials.size).toBe(0);
  },
);

it("возраст сессии ровно десять минут допускает оба шага регистрации", async () => {
  const d = setup();
  const token = d.freshSession();
  d.clock.advance(600_000);
  const { challengeId } = await d.passkeys.registrationOptions(anna, token);
  await d.passkeys.register(
    anna,
    { challengeId, ip, deviceName: "Телефон", response: registration },
    token,
  );
  expect(d.repository.credentials.size).toBe(1);
});

it("сессия может устареть между options и ответом, пока challenge ещё действителен", async () => {
  const d = setup();
  const token = d.freshSession();
  d.clock.advance(540_000);
  const { challengeId } = await d.passkeys.registrationOptions(anna, token);
  d.clock.advance(60_001);
  await expect(
    d.passkeys.register(
      anna,
      { challengeId, ip, deviceName: "Телефон", response: registration },
      token,
    ),
  ).rejects.toThrow(PasskeyReauthenticationRequiredError);
  expect(d.repository.challenges.get(challengeId)?.used).toBe(false);
});

it("медленная выдача options повторно проверяет свежесть перед сохранением challenge", async () => {
  const d = setup();
  const token = d.freshSession();
  const generate = d.verifier.registrationOptions.getMockImplementation();
  if (!generate) throw new Error("Нет тестового verifier");
  d.verifier.registrationOptions.mockImplementationOnce(async (input) => {
    const options = await generate(input);
    d.clock.advance(600_001);
    return options;
  });
  await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow(
    PasskeyReauthenticationRequiredError,
  );
  expect(d.repository.challenges.size).toBe(0);
  expect(d.limiter.attempts.size).toBe(0);
});

it.each(["old", "revoked"] as const)(
  "медленная проверка регистрации повторно проверяет сессию перед записью: %s",
  async (reason) => {
    const d = setup();
    const token = d.freshSession();
    const { challengeId } = await d.passkeys.registrationOptions(anna, token);
    const verify = d.verifier.verifyRegistration.getMockImplementation();
    if (!verify) throw new Error("Нет тестового verifier");
    d.verifier.verifyRegistration.mockImplementationOnce(async (input) => {
      const result = await verify(input);
      if (reason === "old") d.clock.advance(600_001);
      else d.sessions.records.delete(registrationSession(d, token).id);
      return result;
    });
    await expect(
      d.passkeys.register(
        anna,
        { challengeId, ip, deviceName: "Телефон", response: registration },
        token,
      ),
    ).rejects.toThrow(PasskeyReauthenticationRequiredError);
    expect(d.repository.challenges.get(challengeId)?.used).toBe(true);
    expect(d.repository.credentials.size).toBe(0);
    expect(d.logger.warn).not.toHaveBeenCalled();
  },
);

it.each([anna, marina])(
  "options показывает узнаваемый логин в user.name: $kind",
  async (actor) => {
    const d = setup();
    const { options } = await d.passkeys.registrationOptions(
      actor,
      d.freshSession(actor),
    );
    expect(options.user.name).toBe(actor === anna ? "anna" : "marina");
    expect(options.user.id).toBe(actor.userId);
    expect(options.user.name).not.toContain(actor.userId);
  },
);

it.each(["verifier", "storage"] as const)(
  "выдача authentication options освобождает резерв при ошибке: %s",
  async (stage) => {
    const d = setup();
    if (stage === "verifier")
      d.verifier.authenticationOptions.mockRejectedValueOnce(
        new Error("test failure"),
      );
    else
      vi.spyOn(d.repository, "createChallenge").mockRejectedValueOnce(
        new Error("test failure"),
      );
    await expect(d.passkeys.authenticationOptions({ ip })).rejects.toThrow(
      ValidationError,
    );
    expect(d.limiter.attempts.size).toBe(0);
  },
);

it.each(["verifier", "storage"] as const)(
  "выдача registration options освобождает резерв при ошибке: %s",
  async (stage) => {
    const d = setup();
    const token = d.freshSession();
    if (stage === "verifier")
      d.verifier.registrationOptions.mockRejectedValueOnce(
        new Error("test failure"),
      );
    else
      vi.spyOn(d.repository, "createChallenge").mockRejectedValueOnce(
        new Error("test failure"),
      );
    await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow();
    expect(d.limiter.attempts.size).toBe(0);
  },
);

it("authentication options допускает 100 параллельных резервов и освобождает их после завершения", async () => {
  const d = setup();
  const generate = d.verifier.authenticationOptions.getMockImplementation();
  if (!generate) throw new Error("Нет тестового verifier");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  d.verifier.authenticationOptions.mockImplementation(async (input) => {
    await gate;
    return generate(input);
  });
  const pending = Array.from({ length: 100 }, () =>
    d.passkeys.authenticationOptions({ ip }),
  );
  await vi.waitFor(() =>
    expect(d.verifier.authenticationOptions).toHaveBeenCalledTimes(100),
  );
  await expect(d.passkeys.authenticationOptions({ ip })).rejects.toThrow(
    ValidationError,
  );
  release();
  await Promise.all(pending);
  expect(
    d.limiter.attempts.has(`passkey-options:ip:${d.tokens.hash(ip)}`),
  ).toBe(false);
  expect(
    d.limiter.attempts.get(
      `passkey-challenge:authentication:ip:${d.tokens.hash(ip)}`,
    ),
  ).toHaveLength(100);
  await d.passkeys.authenticationOptions({ ip });
  expect(
    d.limiter.attempts.has(`passkey-options:ip:${d.tokens.hash(ip)}`),
  ).toBe(false);
  expect(
    d.limiter.attempts.get(
      `passkey-challenge:authentication:ip:${d.tokens.hash(ip)}`,
    ),
  ).toHaveLength(101);
});

it("registration options ограничивает 20 параллельных выдач пользователю и освобождает резервы", async () => {
  const d = setup();
  const token = d.freshSession();
  const staffToken = d.freshSession(marina);
  const generate = d.verifier.registrationOptions.getMockImplementation();
  if (!generate) throw new Error("Нет тестового verifier");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  d.verifier.registrationOptions.mockImplementation(async (input) => {
    await gate;
    return generate(input);
  });
  const pending = Array.from({ length: 20 }, () =>
    d.passkeys.registrationOptions(anna, token),
  );
  await vi.waitFor(() =>
    expect(d.verifier.registrationOptions).toHaveBeenCalledTimes(20),
  );
  await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow(
    ValidationError,
  );
  const staff = d.passkeys.registrationOptions(marina, staffToken);
  await vi.waitFor(() =>
    expect(d.verifier.registrationOptions).toHaveBeenCalledTimes(21),
  );
  release();
  await Promise.all([...pending, staff]);
  expect([...d.limiter.attempts.keys()].sort()).toEqual(
    [
      `passkey-challenge:registration:user:${d.tokens.hash(anna.userId)}`,
      `passkey-challenge:registration:user:${d.tokens.hash(marina.userId)}`,
    ].sort(),
  );
  expect(
    d.limiter.attempts.get(
      `passkey-challenge:registration:user:${d.tokens.hash(anna.userId)}`,
    ),
  ).toHaveLength(20);
  expect(
    d.limiter.attempts.get(
      `passkey-challenge:registration:user:${d.tokens.hash(marina.userId)}`,
    ),
  ).toHaveLength(1);
});

it("квота выдачи входа ограничивает поток unknown без блокировки пароля, выданного ключа и других IP", async () => {
  const d = setup();
  await d.register();
  const saved = await d.passkeys.authenticationOptions({ ip: "unknown" });
  for (let i = 1; i < PASSKEY_AUTHENTICATION_UNKNOWN_ISSUANCE_LIMIT; i++)
    await d.passkeys.authenticationOptions({ ip: "unknown" });
  const count = d.repository.challenges.size;
  for (let i = 0; i < 5; i++)
    await expect(
      d.passkeys.authenticationOptions({ ip: "unknown" }),
    ).rejects.toMatchObject({
      fieldErrors: { credentials: [PASSKEY_LOGIN_MESSAGE] },
    });
  expect(d.repository.challenges.size).toBe(count);
  await expect(
    d.login.execute({
      login: "timur",
      password: "timur-password",
      ip: "unknown",
    }),
  ).resolves.toMatchObject({ kind: "student" });
  await expect(
    d.passkeys.authenticate({
      challengeId: saved.challengeId,
      ip: "unknown",
      response: authentication,
    }),
  ).resolves.toMatchObject({ kind: "student" });
  await expect(
    d.passkeys.authenticationOptions({ ip }),
  ).resolves.toHaveProperty("challengeId");
  d.clock.advance(PASSKEY_ISSUANCE_WINDOW_SEC * 1000 - 1);
  await expect(
    d.passkeys.authenticationOptions({ ip: "unknown" }),
  ).rejects.toThrow(ValidationError);
  d.clock.advance(1);
  await expect(
    d.passkeys.authenticationOptions({ ip: "unknown" }),
  ).resolves.toHaveProperty("challengeId");
});

it("квота выдачи регистрации фиксирует только сохранённые challenge и независима от пользователя и успешных ключей", async () => {
  const d = setup();
  const token = d.freshSession();
  for (let i = 0; i < PASSKEY_REGISTRATION_ISSUANCE_LIMIT; i++)
    await d.passkeys.registrationOptions(anna, token);
  expect(d.repository.challenges.size).toBe(
    PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
  );
  for (let i = 0; i < 5; i++)
    await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow(
      ValidationError,
    );
  expect(d.repository.challenges.size).toBe(
    PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
  );
  const lastChallenge = [...d.repository.challenges.values()].at(-1);
  await d.passkeys.register(
    anna,
    {
      challengeId: lastChallenge?.id,
      ip,
      deviceName: "Телефон",
      response: registration,
    },
    token,
  );
  expect(await d.passkeys.list(anna)).toHaveLength(1);
  await expect(
    d.passkeys.registrationOptions(marina, d.freshSession(marina)),
  ).resolves.toHaveProperty("challengeId");
  d.clock.advance(PASSKEY_ISSUANCE_WINDOW_SEC * 1000);
  d.forgetFreshSession();
  await expect(
    d.passkeys.registrationOptions(anna, d.freshSession()),
  ).resolves.toHaveProperty("challengeId");
});

async function fillKeys(d: ReturnType<typeof setup>, count: number) {
  const key = await d.register();
  for (let index = 1; index < count; index++) {
    await d.repository.create({
      ...key,
      id: d.ids.next(),
      credentialId: encoded(`credential-${index}`),
    });
  }
}

describe("частота успешных регистраций ключей", () => {
  function distinctRegistrationResults(d: ReturnType<typeof setup>) {
    d.verifier.verifyRegistration.mockImplementation(async ({ response }) => ({
      verified: true,
      credential: {
        id: response.id,
        publicKey: "test-public-key",
        counter: 0,
        transports: ["internal"],
      },
    }));
  }

  async function prepare(
    d: ReturnType<typeof setup>,
    actor: Actor = anna,
    clientIp = ip,
  ) {
    const token = d.freshSession(actor);
    const { challengeId } = await d.passkeys.registrationOptions(actor, token);
    const id = encoded(`rate-credential-${d.ids.next()}`);
    const input = {
      challengeId,
      ip: clientIp,
      deviceName: "Учебный телефон",
      response: { ...registration, id, rawId: id },
    };
    return { execute: () => d.passkeys.register(actor, input, token), input };
  }

  function successes(d: ReturnType<typeof setup>, actor = anna, clientIp = ip) {
    return (
      d.limiter.attempts.get(
        `passkey-registration-success:user-ip:${d.tokens.hash(`${actor.userId}:${clientIp}`)}`,
      ) ?? []
    );
  }

  it.each([false, true])(
    "три успешные регистрации проходят, четвёртая возвращает отдельную ошибку: демо %s",
    async (demo) => {
      const d = setup();
      if (demo) d.repository.demoUsers.add(anna.userId);
      distinctRegistrationResults(d);
      const create = vi.spyOn(d.repository, "create");
      for (let count = 0; count < PASSKEY_REGISTRATION_SUCCESS_LIMIT; count++)
        await (await prepare(d)).execute();
      const fourth = await prepare(d);
      await expect(fourth.execute()).rejects.toThrow(
        PasskeyRegistrationRateLimitedError,
      );
      expect(create).toHaveBeenCalledTimes(3);
      expect(d.repository.credentials.size).toBe(3);
      expect(successes(d)).toHaveLength(3);
      expect(d.repository.challenges.get(fourth.input.challengeId)?.used).toBe(
        true,
      );
      expect(d.logger.warn).not.toHaveBeenCalled();
      expect(new PasskeyRegistrationRateLimitedError()).toBeInstanceOf(
        RateLimitedError,
      );
      expect(new PasskeyRegistrationRateLimitedError().message).toBe(
        "Можно добавить не больше 3 ключей доступа за 15 минут. Попробуйте позже.",
      );
    },
  );

  it.each([
    "verifier",
    "verification-denied",
    "storage-error",
    "storage-limit",
  ] as const)(
    "не тратит лимит успешных регистраций при отказе %s",
    async (failure) => {
      const d = setup();
      distinctRegistrationResults(d);
      const create = vi.spyOn(d.repository, "create");
      for (let attempt = 0; attempt < 4; attempt++) {
        const pending = await prepare(d);
        if (failure === "verifier")
          d.verifier.verifyRegistration.mockRejectedValueOnce(
            new Error("verify"),
          );
        else if (failure === "verification-denied")
          d.verifier.verifyRegistration.mockResolvedValueOnce({
            verified: false,
          });
        else if (failure === "storage-error")
          create.mockRejectedValueOnce(new Error("storage"));
        else create.mockResolvedValueOnce(false);
        await expect(pending.execute()).rejects.toThrow(
          failure === "storage-limit" ? PasskeyLimitError : ValidationError,
        );
        expect(successes(d)).toHaveLength(0);
      }
      for (let count = 0; count < 3; count++)
        await (await prepare(d)).execute();
      expect(successes(d)).toHaveLength(3);
      expect(d.repository.credentials.size).toBe(3);
    },
  );

  it("лимит пары пользователь и IP не блокирует другую пару", async () => {
    const d = setup();
    distinctRegistrationResults(d);
    for (let count = 0; count < 3; count++) await (await prepare(d)).execute();
    await expect((await prepare(d)).execute()).rejects.toThrow(
      PasskeyRegistrationRateLimitedError,
    );
    const otherIp = "198.51.100.54";
    for (let count = 0; count < 3; count++) {
      await (await prepare(d, anna, otherIp)).execute();
      await (await prepare(d, timur)).execute();
    }
    expect(successes(d)).toHaveLength(3);
    expect(successes(d, anna, otherIp)).toHaveLength(3);
    expect(successes(d, timur)).toHaveLength(3);
    expect(await d.passkeys.list(anna)).toHaveLength(6);
    expect(await d.passkeys.list(timur)).toHaveLength(3);
  });

  it("после 15 минут требует свежий вход и заново допускает регистрацию на границе окна", async () => {
    const d = setup();
    distinctRegistrationResults(d);
    for (let count = 0; count < 3; count++) await (await prepare(d)).execute();
    d.clock.advance(PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC * 1000 - 1);
    await expect(prepare(d)).rejects.toThrow(
      PasskeyReauthenticationRequiredError,
    );
    d.forgetFreshSession();
    await expect((await prepare(d)).execute()).rejects.toThrow(
      PasskeyRegistrationRateLimitedError,
    );
    d.clock.advance(1);
    await (await prepare(d)).execute();
    expect(d.repository.credentials.size).toBe(4);
    expect(
      successes(d).filter(
        (row) =>
          row.at >
          d.clock.now().getTime() -
            PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC * 1000,
      ),
    ).toHaveLength(1);
  });

  it("конкурентные валидные ответы резервируют только три успешных записи", async () => {
    const d = setup();
    distinctRegistrationResults(d);
    const attempts = [];
    for (let index = 0; index < 8; index++) attempts.push(await prepare(d));
    const results = await Promise.allSettled(
      attempts.map((attempt) => attempt.execute()),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(3);
    const failures = results.filter((result) => result.status === "rejected");
    expect(failures).toHaveLength(5);
    for (const failure of failures)
      expect(failure.reason).toBeInstanceOf(
        PasskeyRegistrationRateLimitedError,
      );
    expect(successes(d)).toHaveLength(3);
    expect(d.repository.credentials.size).toBe(3);
  });

  it("заблокированная регистрация не вытесняет старый демо-ключ", async () => {
    const d = setup();
    d.repository.demoUsers.add(anna.userId);
    await fillKeys(d, 10);
    distinctRegistrationResults(d);
    for (let count = 0; count < 2; count++) await (await prepare(d)).execute();
    const before = structuredClone([...d.repository.credentials]);
    const create = vi.spyOn(d.repository, "create");
    await expect((await prepare(d)).execute()).rejects.toThrow(
      PasskeyRegistrationRateLimitedError,
    );
    expect(create).not.toHaveBeenCalled();
    expect([...d.repository.credentials]).toEqual(before);
    expect(successes(d)).toHaveLength(3);
  });

  it("долгое резервирование повторно проверяет свежесть и освобождает резерв", async () => {
    const d = setup();
    distinctRegistrationResults(d);
    const pending = await prepare(d);
    const reserve = d.limiter.reserve.bind(d.limiter);
    vi.spyOn(d.limiter, "reserve").mockImplementationOnce(async (rules) => {
      const reservation = await reserve(rules);
      d.clock.advance(600_001);
      return reservation;
    });
    await expect(pending.execute()).rejects.toThrow(
      PasskeyReauthenticationRequiredError,
    );
    expect(successes(d)).toHaveLength(0);
    expect(d.repository.credentials.size).toBe(0);
  });

  it.each([undefined, null, "", "x".repeat(65), 54])(
    "регистрация требует валидный серверный IP: %j",
    async (invalidIp) => {
      const d = setup();
      const pending = await prepare(d);
      await expect(
        d.passkeys.register(
          anna,
          { ...pending.input, ip: invalidIp },
          d.freshSession(),
        ),
      ).rejects.toThrow(ValidationError);
      expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
      expect(successes(d)).toHaveLength(0);
    },
  );
});

it("десять ключей запрещают выдавать новые options с отдельной ошибкой лимита", async () => {
  const d = setup();
  await fillKeys(d, 10);
  const limitsBefore = structuredClone([...d.limiter.attempts]);
  d.verifier.registrationOptions.mockClear();
  await expect(
    d.passkeys.registrationOptions(anna, d.freshSession()),
  ).rejects.toThrow(PasskeyLimitError);
  expect(d.verifier.registrationOptions).not.toHaveBeenCalled();
  expect([...d.limiter.attempts]).toEqual(limitsBefore);
});

it("демо-аккаунт с десятью ключами получает options и заменяет старейший ключ", async () => {
  const d = setup();
  d.repository.demoUsers.add(anna.userId);
  await fillKeys(d, 10);
  const oldest = [...d.repository.credentials.values()][0];
  if (!oldest) throw new Error("Нет ключей для проверки вытеснения");
  d.clock.advance(60_000);
  const token = d.freshSession();
  const { challengeId } = await d.passkeys.registrationOptions(anna, token);
  const id = encoded("new-demo-credential");
  d.verifier.verifyRegistration.mockResolvedValueOnce({
    verified: true,
    credential: { id, publicKey: "test-public-key", counter: 0 },
  });
  await d.passkeys.register(
    anna,
    { challengeId, ip, response: { ...registration, id, rawId: id } },
    token,
  );
  expect(d.repository.credentials.size).toBe(10);
  expect(d.repository.credentials.has(oldest.id)).toBe(false);
  expect([...d.repository.credentials.values()]).toContainEqual(
    expect.objectContaining({
      credentialId: id,
      deviceName: DEMO_PASSKEY_DEVICE_NAME,
    }),
  );
});

it("две регистрации при девяти ключах атомарно сохраняют только десятый и сохраняют ошибку лимита", async () => {
  const d = setup();
  await fillKeys(d, 9);
  const token = d.freshSession();
  const first = await d.passkeys.registrationOptions(anna, token);
  const second = await d.passkeys.registrationOptions(anna, token);
  const ready: (() => void)[] = [];
  d.verifier.verifyRegistration.mockImplementation(
    (input) =>
      new Promise((resolve) => {
        ready.push(() =>
          resolve({
            verified: true,
            credential: {
              id: input.response.id,
              publicKey: "test-public-key",
              counter: 0,
              transports: ["internal"],
            },
          }),
        );
      }),
  );
  const pending = [first, second].map(({ challengeId }, index) => {
    const id = encoded(`race-credential-${index}`);
    return d.passkeys.register(
      anna,
      {
        challengeId,
        ip,
        deviceName: "Телефон",
        response: { ...registration, id, rawId: id },
      },
      token,
    );
  });
  await vi.waitFor(() => expect(ready).toHaveLength(2));
  for (const resolve of ready) resolve();
  const results = await Promise.allSettled(pending);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
    PasskeyLimitError,
  );
  expect(d.repository.credentials.size).toBe(10);
  expect(d.logger.warn).not.toHaveBeenCalled();
});

it("регрессия счётчика получает отдельный фиксированный код без id ключа", async () => {
  const d = setup();
  const key = await d.register();
  key.counter = 7;
  d.verifier.verifyAuthentication.mockResolvedValueOnce({
    verified: true,
    credentialId: key.credentialId,
    newCounter: 6,
  });
  await expect(
    d.passkeys.authenticate(await d.assertion()),
  ).rejects.toMatchObject({
    fieldErrors: { credentials: [PASSKEY_LOGIN_MESSAGE] },
  });
  expect(d.logger.warn.mock.calls).toEqual([
    ["passkey_counter_regression", { code: "PASSKEY_COUNTER_REGRESSION" }],
    ["passkey_login_failed", { code: "PASSKEY_LOGIN_FAILED" }],
  ]);
  expect(JSON.stringify(d.logger.warn.mock.calls)).not.toContain(
    key.credentialId,
  );
});

it.each([
  { step: "options", boundary: "freshness" },
  { step: "registration", boundary: "freshness" },
  { step: "options", boundary: "expiry" },
  { step: "registration", boundary: "expiry" },
])(
  "задержка чтения сессии проверяется по времени после await: $step / $boundary",
  async ({ step, boundary }) => {
    const d = setup();
    const token = d.freshSession();
    const challenge =
      step === "registration"
        ? await d.passkeys.registrationOptions(anna, token)
        : null;
    if (boundary === "freshness") d.clock.advance(600_000);
    else
      registrationSession(d, token).expiresAt = new Date(
        d.clock.now().getTime() + 1,
      ).toISOString();
    const findValid = d.sessions.findValid.bind(d.sessions);
    vi.spyOn(d.sessions, "findValid").mockImplementationOnce(
      async (hash, lookupNow) => {
        const session = await findValid(hash, lookupNow);
        d.clock.advance(1);
        return session;
      },
    );
    if (challenge) {
      await expect(
        d.passkeys.register(
          anna,
          {
            challengeId: challenge.challengeId,
            ip,
            deviceName: "Телефон",
            response: registration,
          },
          token,
        ),
      ).rejects.toThrow(PasskeyReauthenticationRequiredError);
      expect(d.repository.challenges.get(challenge.challengeId)?.used).toBe(
        false,
      );
    } else {
      await expect(d.passkeys.registrationOptions(anna, token)).rejects.toThrow(
        PasskeyReauthenticationRequiredError,
      );
      expect(d.verifier.registrationOptions).not.toHaveBeenCalled();
    }
    expect(d.verifier.verifyRegistration).not.toHaveBeenCalled();
    expect(d.repository.credentials.size).toBe(0);
  },
);
