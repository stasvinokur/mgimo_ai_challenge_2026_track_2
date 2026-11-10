import { describe, expect, it } from "vitest";
import type { PasskeyRecord } from "@/application/identity/passkey-ports";
import { Passkeys } from "@/application/identity/passkeys";
import type { Actor } from "@/application/ports/actor";
import type {
  PasskeyRegistrationResponse,
  PasskeyVerifier,
} from "@/application/ports/passkey-verifier";
import { RateLimitedError, ValidationError } from "@/application/shared/errors";
import {
  DEMO_PASSKEY_DEVICE_NAME,
  PASSKEY_REGISTRATION_SUCCESS_LIMIT,
  PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC,
} from "@/domain/identity/passkey-policy";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresPasskeyRepository } from "@/infrastructure/db/repositories/identity/passkeys";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { FakeSessionStore } from "../fakes/identity";

const ip = "192.0.2.54";
const otherIp = "192.0.2.55";

async function fixture(demo: boolean) {
  const sql = createDatabase(8);
  const ids = new UuidV7Generator();
  const tokens = new CryptoSessionTokens();
  const clock = new FakeClock(new Date());
  const sessions = new FakeSessionStore();
  const repository = new PostgresPasskeyRepository(() => sql);
  const userId = ids.next();
  const actor: Actor = {
    kind: "student",
    userId,
    studentId: ids.next(),
    facultyId: ids.next(),
  };
  const rateKey = (address = ip) =>
    `passkey-registration-success:user-ip:${tokens.hash(`${userId}:${address}`)}`;
  const rejectedCredentials = new Set<string>();
  const verifier: PasskeyVerifier = {
    async registrationOptions({ userId, userName }) {
      return {
        challenge: ids.next(),
        rp: { id: "localhost", name: "Пульс" },
        user: { id: userId, name: userName, displayName: userName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 300_000,
        attestation: "none",
        excludeCredentials: [],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      };
    },
    async verifyRegistration({ response }) {
      return rejectedCredentials.has(response.id)
        ? { verified: false }
        : {
            verified: true,
            credential: { id: response.id, publicKey: "dGVzdA", counter: 0 },
          };
    },
    async authenticationOptions() {
      throw new Error("Вход в этом тесте не вызывается");
    },
    async verifyAuthentication() {
      throw new Error("Вход в этом тесте не вызывается");
    },
  };
  const passkeys = new Passkeys({
    repository,
    verifier,
    users: new PostgresIdentityRepository(() => sql),
    limiter: new PostgresRateLimiter(() => sql, clock, ids),
    sessions,
    tokens,
    clock,
    ids,
    logger: { info() {}, warn() {}, error() {} },
  });
  function freshSession() {
    const token = tokens.generate();
    const now = clock.now().toISOString();
    const id = ids.next();
    sessions.records.set(id, {
      id,
      userId,
      tokenHash: tokens.hash(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    });
    return token;
  }
  let token = freshSession();
  async function prepare(address = ip, credentialId = ids.next()) {
    const { challengeId } = await passkeys.registrationOptions(actor, token);
    const response: PasskeyRegistrationResponse = {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      clientExtensionResults: {},
      response: { clientDataJSON: "dGVzdA", attestationObject: "dGVzdA" },
    };
    return {
      challengeId,
      response,
      ip: address,
      deviceName: "Учебный телефон",
    };
  }
  async function register(address = ip) {
    return passkeys.register(actor, await prepare(address), token);
  }
  async function count(address = ip) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from login_attempts where key = ${rateKey(address)}`;
    return row?.n ?? 0;
  }
  async function fillDemo() {
    for (let index = 0; index < 10; index++) {
      const record: PasskeyRecord = {
        id: ids.next(),
        userId,
        credentialId: ids.next(),
        publicKey: "dGVzdA",
        counter: 0,
        transports: [],
        deviceName: DEMO_PASSKEY_DEVICE_NAME,
        createdAt: new Date(
          clock.now().getTime() - (10 - index) * 60_000,
        ).toISOString(),
        lastUsedAt: null,
      };
      await repository.create(record);
    }
  }
  try {
    await sql`insert into users (id, login, password_hash, role, seed_key)
      values (${userId}, ${`passkey-rate-${userId}`}, '$argon2id$test-fixture', 'student',
        ${demo ? `passkey-rate:${userId}` : null})`;
  } catch (error) {
    await sql.end({ timeout: 1 });
    throw error;
  }
  return {
    actor,
    sql,
    clock,
    passkeys,
    repository,
    rejectedCredentials,
    prepare,
    register,
    count,
    fillDemo,
    registerPrepared: (input: Awaited<ReturnType<typeof prepare>>) =>
      passkeys.register(actor, input, token),
    renewSession() {
      token = freshSession();
    },
    async close() {
      try {
        await sql`delete from users where id = ${userId}`;
        const keys = [
          rateKey(),
          rateKey(otherIp),
          `passkey-registration-options:user:${tokens.hash(userId)}`,
          `passkey-challenge:registration:user:${tokens.hash(userId)}`,
        ];
        await sql`delete from login_attempts where key = any(${keys}::text[])`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Лимит успешных регистраций ключей на PostgreSQL",
  () => {
    it.each([false, true])(
      "четвёртая регистрация запрещена без вытеснения; окно и пары независимы, demo=%s",
      async (demo) => {
        const d = await fixture(demo);
        const other = await fixture(false);
        try {
          if (demo) await d.fillDemo();
          for (
            let index = 0;
            index < PASSKEY_REGISTRATION_SUCCESS_LIMIT;
            index++
          )
            await d.register();
          expect(await d.count()).toBe(3);
          const before = await d.repository.listForUser(d.actor.userId);
          await expect(d.register()).rejects.toBeInstanceOf(RateLimitedError);
          expect(await d.repository.listForUser(d.actor.userId)).toEqual(
            before,
          );
          expect(await d.count()).toBe(3);
          await d.register(otherIp);
          expect(await d.count(otherIp)).toBe(1);
          await other.register();
          expect(await other.count()).toBe(1);
          d.clock.advance(PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC * 1000);
          d.renewSession();
          await d.register();
          expect(await d.repository.listForUser(d.actor.userId)).toHaveLength(
            demo ? 10 : 5,
          );
        } finally {
          await d.close();
          await other.close();
        }
      },
      30_000,
    );

    it("шесть одновременных успешных ответов verifier оставляют только три регистрации и три записи лимита", async () => {
      const d = await fixture(true);
      try {
        await d.fillDemo();
        const initial = await d.repository.listForUser(d.actor.userId);
        const inputs = await Promise.all(
          Array.from({ length: 6 }, () => d.prepare()),
        );
        const results = await Promise.allSettled(
          inputs.map(d.registerPrepared),
        );
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(3);
        for (const result of results)
          if (result.status === "rejected")
            expect(result.reason).toBeInstanceOf(RateLimitedError);
        const after = await d.repository.listForUser(d.actor.userId);
        expect(after).toHaveLength(10);
        expect(
          after.filter((key) => initial.some((old) => old.id === key.id)),
        ).toHaveLength(7);
        expect(await d.count()).toBe(3);
      } finally {
        await d.close();
      }
    }, 30_000);

    it("неудачная подпись и rollback вставки не занимают слот успешной регистрации", async () => {
      const d = await fixture(true);
      try {
        await d.fillDemo();
        const before = await d.repository.listForUser(d.actor.userId);
        const invalid = await d.prepare();
        d.rejectedCredentials.add(invalid.response.id);
        await expect(d.registerPrepared(invalid)).rejects.toBeInstanceOf(
          ValidationError,
        );
        const duplicate = await d.prepare(ip, before[0]?.credentialId);
        await expect(d.registerPrepared(duplicate)).rejects.toBeInstanceOf(
          ValidationError,
        );
        expect(await d.count()).toBe(0);
        expect(await d.repository.listForUser(d.actor.userId)).toEqual(before);
        for (let index = 0; index < 3; index++) await d.register();
        expect(await d.count()).toBe(3);
      } finally {
        await d.close();
      }
    }, 30_000);
  },
);
