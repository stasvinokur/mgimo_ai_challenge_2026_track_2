import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { demoAccounts } from "@/application/identity/demo-accounts";
import { GetCurrentActor } from "@/application/identity/get-current-actor";
import { Login } from "@/application/identity/login";
import { Passkeys } from "@/application/identity/passkeys";
import type { PasskeyVerifier } from "@/application/ports/passkey-verifier";
import type { PasswordHasher } from "@/application/ports/password-hasher";
import { ValidationError } from "@/application/shared/errors";
import { Argon2PasswordHasher } from "@/infrastructure/auth/argon2-password-hasher";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import {
  createDatabase,
  normalizeDatabaseValue,
} from "@/infrastructure/db/client";
import { PostgresPasskeyRepository } from "@/infrastructure/db/repositories/identity/passkeys";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { refreshDemo, seedDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";

const clock = new FakeClock("2026-11-10T09:00:00Z");
const hasher = new Argon2PasswordHasher();
const tokens = new CryptoSessionTokens();
const ids = new UuidV7Generator();
type Database = ReturnType<typeof createDatabase>;

function secret(version: number) {
  return demoAccounts
    .map(
      (account) =>
        `${account.login}:test${version}${account.login}Password2026`,
    )
    .join(",");
}

async function withTemporaryDatabase(
  action: (sql: Database, url: string) => Promise<void>,
) {
  const admin = createDatabase(1);
  const name = `identity_demo_${randomUUID().replaceAll("-", "")}`;
  let sql: Database | undefined;
  let created = false;
  try {
    await admin`create database ${admin(name)}`;
    created = true;
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), {
      max: 5,
      onnotice: () => {},
      connection: { statement_timeout: 10_000 },
      transform: { value: { from: normalizeDatabaseValue } },
    });
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(
        new URL("../../drizzle/", import.meta.url),
      ),
    });
    await action(sql, url.toString());
  } finally {
    if (sql) await sql.end({ timeout: 1 });
    if (created) await admin`drop database ${admin(name)} with (force)`;
    await admin.end({ timeout: 1 });
  }
}

function auth(sql: Database, passwords: PasswordHasher = hasher) {
  const users = new PostgresIdentityRepository(() => sql);
  const sessions = new PostgresSessionStore(() => sql);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const limiter = new PostgresRateLimiter(() => sql, clock, ids);
  const deps = { users, sessions, tokens, clock, ids, logger, limiter };
  const login = new Login({
    ...deps,
    passwords,
    dummyHash: () => hasher.hash("test-dummy-password"),
  });
  const verifier: PasskeyVerifier = {
    async registrationOptions() {
      throw new Error("Регистрация не используется в этом тесте.");
    },
    async authenticationOptions() {
      return {
        challenge: tokens.generate(),
        rpId: "example.invalid",
        timeout: 60_000,
        allowCredentials: [],
        userVerification: "required",
      };
    },
    async verifyRegistration() {
      return { verified: false };
    },
    async verifyAuthentication({ credential }) {
      return {
        verified: true,
        credentialId: credential.id,
        newCounter: credential.counter + 1,
      };
    },
  };
  const passkeys = new Passkeys({
    ...deps,
    repository: new PostgresPasskeyRepository(() => sql),
    verifier,
  });
  return {
    logger,
    current: new GetCurrentActor(sessions, users, tokens, clock),
    login: (name: string, password: string) =>
      login.execute({
        login: name,
        password,
        ip: `2001:db8:${randomUUID().slice(0, 4)}::1`,
      }),
    async loginWithPasskey(credentialId: string) {
      const ip = "192.0.2.58";
      const options = await passkeys.authenticationOptions({ ip });
      return passkeys.authenticate({
        challengeId: options.challengeId,
        ip,
        response: {
          id: credentialId,
          rawId: credentialId,
          type: "public-key",
          clientExtensionResults: {},
          response: {
            clientDataJSON: "dGVzdA",
            authenticatorData: "dGVzdA",
            signature: "dGVzdA",
          },
        },
      });
    },
  };
}

async function addAccess(sql: Database, userId: string) {
  const now = clock.now().toISOString();
  const credentialId = tokens.generate();
  await sql`insert into passkey_credentials (id, user_id, credential_id, public_key, device_name, created_at)
    values (${ids.next()}, ${userId}, ${credentialId}, 'test-public-key', 'Учебный ключ', ${now}::timestamptz)`;
  await sql`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
    values (${ids.next()}, ${userId}, ${`https://push.example.invalid/${userId}`}, 'test-p256dh', 'test-auth', ${now}::timestamptz)`;
  for (const purpose of ["registration", "authentication"])
    await sql`insert into webauthn_challenges (id, user_id, purpose, challenge_hash, created_at, expires_at)
      values (${ids.next()}, ${userId}, ${purpose}, ${tokens.hash(ids.next())}, ${now}::timestamptz, ${new Date(clock.now().getTime() + 300_000).toISOString()}::timestamptz)`;
  await sql`insert into calendar_tokens (id, student_id, token_hash)
    select ${ids.next()}, id, ${tokens.hash(ids.next())} from students where user_id = ${userId}`;
  return credentialId;
}

async function access(sql: Database, userId: string) {
  return {
    sessions:
      await sql`select * from sessions where user_id = ${userId} order by id`,
    keys: await sql`select * from passkey_credentials where user_id = ${userId} order by id`,
    challenges:
      await sql`select * from webauthn_challenges where user_id = ${userId} order by id`,
    push: await sql`select * from push_subscriptions where user_id = ${userId} order by id`,
    calendar:
      await sql`select c.* from calendar_tokens c join students s on s.id = c.student_id where s.user_id = ${userId} order by c.id`,
  };
}

async function addOrdinaryStudent(sql: Database) {
  const userId = ids.next();
  const login = `ordinary-${userId}`;
  await sql`insert into users (id, login, role, password_hash)
    select ${userId}, ${login}, role, password_hash from users where login = 'anna'`;
  await sql`insert into students (id, user_id, full_name, faculty_id, program_id, course, group_id, record_book_no, scholarship, target_score)
    select ${ids.next()}, ${userId}, full_name, faculty_id, program_id, course, group_id, ${`DEMO-${userId}`}, scholarship, target_score
    from students where user_id = (select id from users where login = 'anna')`;
  return { userId, login };
}

describe.skipIf(!process.env.DATABASE_URL)("Пароли сида на PostgreSQL", () => {
  it("свежая временная БД: настоящий Login принимает секрет, отвергает локальные пароли", async () => {
    await withTemporaryDatabase(async (sql, url) => {
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", secret(1));
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/seed.ts"],
        {
          env: { ...process.env, DATABASE_URL: url },
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        "Демо-данные подготовлены. Пользовательские записи сохранены.",
      );
      expect(result.stderr).toBe("");
      const authentication = auth(sql);
      for (const account of demoAccounts) {
        await expect(
          authentication.login(account.login, account.password),
        ).rejects.toBeInstanceOf(ValidationError);
        const session = await authentication.login(
          account.login,
          `test1${account.login}Password2026`,
        );
        expect(session.kind).toBe(account.role);
        expect(
          await authentication.current.execute(session.token),
        ).not.toBeNull();
      }
      const logs = JSON.stringify(
        Object.values(authentication.logger).flatMap((fn) => fn.mock.calls),
      );
      expect(logs).not.toContain("Password2026");
      expect(logs).not.toContain("demo-2026");
      expect(logs).not.toContain(secret(1));
    });
  }, 30_000);

  it("временная БД: только смена пароля отбирает все виды доступа; повтор, отсутствие секрета и refresh их сохраняют", async () => {
    await withTemporaryDatabase(async (sql) => {
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", secret(1));
      await seedDemo(sql, clock);
      const authentication = auth(sql);
      const ordinary = await addOrdinaryStudent(sql);
      const owners = await sql<
        { id: string; login: string }[]
      >`select id, login from users order by login`;
      const active = new Map<string, string>();
      const credentials = new Map<string, string>();
      for (const owner of owners) {
        const login = await authentication.login(
          owner.login,
          `test1${owner.login === ordinary.login ? "anna" : owner.login}Password2026`,
        );
        active.set(owner.id, login.token);
        credentials.set(owner.id, await addAccess(sql, owner.id));
      }
      const anna = owners.find((owner) => owner.login === "anna");
      if (!anna) throw new Error("Нет тестовой Анны.");
      const credential = credentials.get(anna.id);
      if (!credential) throw new Error("Нет тестового ключа.");
      expect((await authentication.loginWithPasskey(credential)).kind).toBe(
        "student",
      );
      const before = new Map<string, Awaited<ReturnType<typeof access>>>();
      for (const owner of owners)
        before.set(owner.id, await access(sql, owner.id));
      const first = await sql`select id, password_hash from users order by id`;
      await seedDemo(sql, clock);
      expect(
        await sql`select id, password_hash from users order by id`,
      ).toEqual(first);
      for (const owner of owners)
        expect(await access(sql, owner.id)).toEqual(before.get(owner.id));

      vi.stubEnv(
        "DEMO_ACCOUNT_PASSWORDS",
        secret(1).replace("test1annaPassword2026", "test2annaPassword2026"),
      );
      await seedDemo(sql, clock);
      const second = await sql`select id, password_hash from users order by id`;
      expect(
        second.filter(
          (row, i) => row.password_hash !== first[i]?.password_hash,
        ),
      ).toHaveLength(1);
      expect(await access(sql, anna.id)).toEqual({
        sessions: [],
        keys: [],
        challenges: [],
        push: [],
        calendar: [],
      });
      for (const owner of owners) {
        if (owner.id !== anna.id)
          expect(await access(sql, owner.id)).toEqual(before.get(owner.id));
        expect(
          Boolean(await authentication.current.execute(active.get(owner.id))),
        ).toBe(owner.id !== anna.id);
      }
      await expect(
        authentication.loginWithPasskey(credential),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        authentication.login("anna", "test1annaPassword2026"),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        authentication.login("anna", "anna-demo-2026"),
      ).rejects.toBeInstanceOf(ValidationError);
      const fresh = await authentication.login("anna", "test2annaPassword2026");
      await addAccess(sql, anna.id);
      const freshAccess = await access(sql, anna.id);
      await seedDemo(sql, clock);
      expect(await access(sql, anna.id)).toEqual(freshAccess);
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", undefined);
      await seedDemo(sql, clock);
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", "invalid-test-secret");
      await refreshDemo(sql, clock);
      expect(await access(sql, anna.id)).toEqual(freshAccess);
      expect(
        await sql`select id, password_hash from users order by id`,
      ).toEqual(second);
      expect(await authentication.current.execute(fresh.token)).not.toBeNull();
    });
  }, 30_000);

  it("управляемая гонка: Login со старым хэшем ждёт коммит сида, поздняя сессия затем отозвана", async () => {
    await withTemporaryDatabase(async (sql) => {
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", undefined);
      await seedDemo(sql, clock);
      const key = Number.parseInt(
        randomUUID().replaceAll("-", "").slice(0, 7),
        16,
      );
      await sql.unsafe(`create function pause_demo_rotation() returns trigger language plpgsql as $$
        begin
          if old.login = 'anna' and old.password_hash is distinct from new.password_hash then
            perform pg_advisory_xact_lock(${key});
          end if;
          return new;
        end $$`);
      await sql`create trigger pause_demo_rotation before update of password_hash on users
        for each row execute function pause_demo_rotation()`;
      const blocker = await sql.reserve();
      let rotation: Promise<void> | undefined;
      let oldLogin: ReturnType<ReturnType<typeof auth>["login"]> | undefined;
      let slowLogin: ReturnType<ReturnType<typeof auth>["login"]> | undefined;
      const verificationReady = Promise.withResolvers<void>();
      const finishVerification = Promise.withResolvers<void>();
      try {
        await blocker`select pg_advisory_lock(${key})`;
        vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", secret(1));
        rotation = seedDemo(sql, clock);
        await expect
          .poll(
            async () => {
              const rows =
                await sql`select 1 from pg_locks where locktype = 'advisory' and objid = ${key} and not granted`;
              return rows.length;
            },
            { timeout: 5_000 },
          )
          .toBe(1);
        const authentication = auth(sql);
        oldLogin = authentication.login("anna", "anna-demo-2026");
        const delayedAuth = auth(sql, {
          hash: (value) => hasher.hash(value),
          async verify(hash, password) {
            const matches = await hasher.verify(hash, password);
            verificationReady.resolve();
            await finishVerification.promise;
            return matches;
          },
        });
        slowLogin = delayedAuth.login("anna", "anna-demo-2026");
        await verificationReady.promise;
        await expect
          .poll(
            async () => {
              const rows = await sql`select 1 from pg_stat_activity
            where datname = current_database() and wait_event = 'transactionid' and query like 'insert into sessions%'`;
              return rows.length;
            },
            { timeout: 5_000 },
          )
          .toBe(1);
        await blocker`select pg_advisory_unlock(${key})`;
        const stale = await oldLogin;
        // Its insert proves the rotation has committed. The second verifier returns afterwards.
        finishVerification.resolve();
        const delayed = await slowLogin;
        await rotation;
        expect(await authentication.current.execute(stale.token)).toBeNull();
        expect(await authentication.current.execute(delayed.token)).toBeNull();
        expect(
          (await authentication.login("anna", "test1annaPassword2026")).kind,
        ).toBe("student");
      } finally {
        finishVerification.resolve();
        await blocker`select pg_advisory_unlock_all()`;
        blocker.release();
        await Promise.allSettled([rotation, oldLogin, slowLogin]);
      }
    });
  }, 30_000);
});
