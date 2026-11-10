import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Passkeys } from "@/application/identity/passkeys";
import type { Actor } from "@/application/ports/actor";
import type { PasskeyVerifier } from "@/application/ports/passkey-verifier";
import { ValidationError } from "@/application/shared/errors";
import {
  PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT,
  PASSKEY_ISSUANCE_WINDOW_SEC,
  PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
} from "@/domain/identity/passkey-policy";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresPasskeyRepository } from "@/infrastructure/db/repositories/identity/passkeys";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { FakeSessionStore } from "../fakes/identity";

async function fixture() {
  const sql = createDatabase(8);
  const generator = new UuidV7Generator();
  const generatedIds: string[] = [];
  const ids = {
    next() {
      const id = generator.next();
      generatedIds.push(id);
      return id;
    },
  };
  const tokens = new CryptoSessionTokens();
  const clock = new FakeClock(new Date());
  const sessions = new FakeSessionStore();
  const repository = new PostgresPasskeyRepository(() => sql);
  const actors: Actor[] = [0, 1].map(() => ({
    kind: "student",
    userId: ids.next(),
    studentId: ids.next(),
    facultyId: ids.next(),
  }));
  const addresses = [randomUUID(), randomUUID()];
  const keys = new Set<string>();
  const authenticationKey = (ip: string) => {
    const key = `passkey-challenge:authentication:ip:${tokens.hash(ip)}`;
    keys.add(key);
    keys.add(`passkey-options:ip:${tokens.hash(ip)}`);
    keys.add(`ip:${tokens.hash(ip)}`);
    return key;
  };
  const registrationKey = (actor: Actor) => {
    const key = `passkey-challenge:registration:user:${tokens.hash(actor.userId)}`;
    keys.add(key);
    keys.add(`passkey-registration-options:user:${tokens.hash(actor.userId)}`);
    return key;
  };
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
    async authenticationOptions() {
      return {
        challenge: ids.next(),
        rpId: "localhost",
        timeout: 300_000,
        allowCredentials: [],
        userVerification: "required",
      };
    },
    async verifyRegistration() {
      throw new Error("Подпись в проверке выдачи не используется.");
    },
    async verifyAuthentication() {
      throw new Error("Подпись в проверке выдачи не используется.");
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
  function freshSession(actor: Actor) {
    const token = tokens.generate();
    const id = ids.next();
    const now = clock.now().toISOString();
    sessions.records.set(id, {
      id,
      userId: actor.userId,
      tokenHash: tokens.hash(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    });
    return token;
  }
  const owner = actors[0];
  const other = actors[1];
  const ip = addresses[0];
  const otherIp = addresses[1];
  if (!owner || !other || !ip || !otherIp)
    throw new Error("Не подготовлены временные владельцы.");
  let token = freshSession(owner);
  async function count(key: string) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from login_attempts where key = ${key}`;
    return row?.n ?? 0;
  }
  async function challengeCount() {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from webauthn_challenges
      where id = any(${generatedIds}::uuid[])`;
    return row?.n ?? 0;
  }
  async function prime(key: string, count: number) {
    await sql`
      insert into login_attempts (id, key, at)
      select gen_random_uuid(), ${key}, ${clock.now().toISOString()}::timestamptz
      from generate_series(1, ${count})`;
  }
  try {
    for (const actor of actors)
      await sql`insert into users (id, login, password_hash, role)
        values (${actor.userId}, ${`passkey-options-${actor.userId}`}, '$argon2id$test-fixture', 'student')`;
  } catch (error) {
    await sql`delete from users where id = any(${actors.map((actor) => actor.userId)}::uuid[])`;
    await sql.end({ timeout: 1 });
    throw error;
  }
  return {
    sql,
    clock,
    owner,
    other,
    ip,
    otherIp,
    count,
    challengeCount,
    prime,
    authenticationKey,
    registrationKey,
    authentication: (address = ip) => {
      authenticationKey(address);
      return passkeys.authenticationOptions({ ip: address });
    },
    registration: (actor = owner) => {
      registrationKey(actor);
      return passkeys.registrationOptions(
        actor,
        actor === owner ? token : freshSession(actor),
      );
    },
    renewSession() {
      token = freshSession(owner);
    },
    async close() {
      try {
        await sql`delete from webauthn_challenges where id = any(${generatedIds}::uuid[])`;
        await sql`delete from login_attempts where key = any(${[...keys]}::text[])`;
        await sql`delete from users where id = any(${actors.map((actor) => actor.userId)}::uuid[])`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Квота выдачи challenge на PostgreSQL",
  () => {
    it.each([
      ["authentication", PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT],
      ["registration", PASSKEY_REGISTRATION_ISSUANCE_LIMIT],
    ] as const)(
      "последовательный поток %s создаёт не больше квоты и не считается неудачным входом",
      async (purpose, limit) => {
        const d = await fixture();
        try {
          const issue = () => d[purpose]();
          for (let index = 0; index < limit; index++) await issue();
          for (let index = 0; index < 10; index++)
            await expect(issue()).rejects.toBeInstanceOf(ValidationError);
          expect(await d.challengeCount()).toBe(limit);
          const key =
            purpose === "authentication"
              ? d.authenticationKey(d.ip)
              : d.registrationKey(d.owner);
          expect(await d.count(key)).toBe(limit);
          expect(
            await d.count(`ip:${new CryptoSessionTokens().hash(d.ip)}`),
          ).toBe(0);
          expect(
            await d.count(
              `passkey-options:ip:${new CryptoSessionTokens().hash(d.ip)}`,
            ),
          ).toBe(0);
          expect(
            await d.count(
              `passkey-registration-options:user:${new CryptoSessionTokens().hash(d.owner.userId)}`,
            ),
          ).toBe(0);
        } finally {
          await d.close();
        }
      },
      60_000,
    );

    it.each([
      ["authentication", PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT],
      ["registration", PASSKEY_REGISTRATION_ISSUANCE_LIMIT],
    ] as const)(
      "одновременные выдачи %s не обходят последние три места квоты",
      async (purpose, limit) => {
        const d = await fixture();
        try {
          const key =
            purpose === "authentication"
              ? d.authenticationKey(d.ip)
              : d.registrationKey(d.owner);
          await d.prime(key, limit - 3);
          const results = await Promise.allSettled(
            Array.from({ length: 12 }, () => d[purpose]()),
          );
          expect(
            results.filter((result) => result.status === "fulfilled"),
          ).toHaveLength(3);
          for (const result of results)
            if (result.status === "rejected")
              expect(result.reason).toBeInstanceOf(ValidationError);
          expect(await d.challengeCount()).toBe(3);
          expect(await d.count(key)).toBe(limit);
        } finally {
          await d.close();
        }
      },
      30_000,
    );

    it("квоты разных IP и пользователей независимы и открываются ровно через 15 минут", async () => {
      const d = await fixture();
      try {
        await d.prime(
          d.authenticationKey(d.ip),
          PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT,
        );
        await d.prime(
          d.registrationKey(d.owner),
          PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
        );
        await expect(d.authentication()).rejects.toBeInstanceOf(
          ValidationError,
        );
        await expect(d.registration()).rejects.toBeInstanceOf(ValidationError);
        await d.authentication(d.otherIp);
        await d.registration(d.other);
        d.clock.advance(PASSKEY_ISSUANCE_WINDOW_SEC * 1000 - 1);
        d.renewSession();
        await expect(d.authentication()).rejects.toBeInstanceOf(
          ValidationError,
        );
        await expect(d.registration()).rejects.toBeInstanceOf(ValidationError);
        d.clock.advance(1);
        await d.authentication();
        await d.registration();
        expect(await d.challengeCount()).toBe(4);
      } finally {
        await d.close();
      }
    }, 30_000);
  },
);
