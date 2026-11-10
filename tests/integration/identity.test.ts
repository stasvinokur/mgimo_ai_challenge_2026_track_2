import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Login } from "@/application/identity/login";
import { RateLimitedError, ValidationError } from "@/application/shared/errors";
import { Argon2PasswordHasher } from "@/infrastructure/auth/argon2-password-hasher";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { PostgresStudentRepository } from "@/infrastructure/db/repositories/student/profile";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { cleanupIdentity } from "../../scripts/cleanup-identity";
import { seedDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)(
  "Identity на живом PostgreSQL",
  () => {
    const clock = new FakeClock("2026-11-04T09:00:00Z");
    const ids = new UuidV7Generator();
    const prefix = `identity-test:${ids.next()}`;
    let sql: ReturnType<typeof createDatabase>;
    const sessionIds: string[] = [];
    const attemptKeys = new Set<string>();
    beforeAll(async () => {
      sql = createDatabase(3);
      await migrate(drizzle(sql), {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle/", import.meta.url),
        ),
      });
      await seedDemo(sql, clock);
    }, 30_000);
    afterAll(async () => {
      if (sql) {
        for (const id of sessionIds)
          await sql`delete from sessions where id = ${id}`;
        await sql`delete from login_attempts where key like ${`${prefix}%`}`;
        for (const key of attemptKeys)
          await sql`delete from login_attempts where key = ${key}`;
        await sql.end({ timeout: 1 });
      }
    });

    it("репозиторий читает argon2id и строит разные Actor; staff получает свои факультеты", async () => {
      const users = new PostgresIdentityRepository(() => sql);
      const anna = await users.findCredentials("anna");
      const timur = await users.findCredentials("timur");
      const marina = await users.findCredentials("marina");
      expect(await users.findCredentials("missing-test-user")).toBeNull();
      expect(anna?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(
        await new Argon2PasswordHasher().verify(
          anna?.passwordHash ?? "",
          "anna-demo-2026",
        ),
      ).toBe(true);
      const actors = await Promise.all(
        [anna, timur, marina].map((user) =>
          users.findActorByUserId(user?.userId ?? ids.next()),
        ),
      );
      expect(actors[0]).toMatchObject({ kind: "student" });
      expect(actors[1]).toMatchObject({ kind: "student" });
      expect(actors[0]).not.toEqual(actors[1]);
      const actor = actors[2];
      expect(actor).toMatchObject({ kind: "staff" });
      if (actor?.kind !== "staff") throw new Error("Нет демо-сотрудника.");
      expect(actor.facultyIds).toHaveLength(2);
      const expected = await sql<
        { id: string }[]
      >`select faculty_id as id from staff_faculties where staff_id = ${actor.staffId} order by faculty_id`;
      expect(actor.facultyIds).toEqual(expected.map((row) => row.id));
      expect(
        await users.findProfileForStaff(actor.staffId, actor.userId),
      ).toMatchObject({
        fullName: "Марина Петровна Ладова",
        faculties: expect.any(Array),
      });
      expect(
        await users.findProfileForStaff(actor.staffId, anna?.userId ?? ""),
      ).toBeNull();
      const students = new PostgresStudentRepository(() => sql);
      const profiles = [];
      for (const student of actors.slice(0, 2)) {
        if (student?.kind !== "student") throw new Error("Нет демо-студента.");
        profiles.push(await students.findProfileForStudent(student.studentId));
      }
      expect(profiles[0]?.fullName).toContain("Анна");
      expect(profiles[1]?.fullName).toContain("Тимур");
      expect(profiles[0]?.recordBookNo).not.toBe(profiles[1]?.recordBookNo);
    });

    it("SessionStore хранит хэш, проверяет срок, продлевает без обратного хода и отзывает", async () => {
      const credentials = await new PostgresIdentityRepository(
        () => sql,
      ).findCredentials("anna");
      if (!credentials) throw new Error("Нет демо-аккаунта.");
      const sessions = new PostgresSessionStore(() => sql);
      const tokens = new CryptoSessionTokens();
      const token = tokens.generate();
      const id = ids.next();
      sessionIds.push(id);
      const record = {
        id,
        userId: credentials.userId,
        tokenHash: tokens.hash(token),
        createdAt: "2026-11-04T09:00:00.000Z",
        expiresAt: "2026-11-11T09:00:00.000Z",
        lastSeenAt: "2026-11-04T09:00:00.000Z",
      };
      await sessions.create(record);
      expect(await sessions.findValid(token, clock.now())).toBeNull();
      expect(await sessions.findValid(record.tokenHash, clock.now())).toEqual(
        record,
      );
      const [stored] = await sql`select * from sessions where id = ${id}`;
      expect(JSON.stringify(stored)).not.toContain(token);
      await sessions.touch(
        id,
        new Date("2026-11-04T09:15:00Z"),
        new Date("2026-11-11T09:15:00Z"),
      );
      await sessions.touch(
        id,
        new Date("2026-11-04T09:10:00Z"),
        new Date("2026-11-11T09:10:00Z"),
      );
      expect(
        await sessions.findValid(record.tokenHash, clock.now()),
      ).toMatchObject({
        lastSeenAt: "2026-11-04T09:15:00.000Z",
        expiresAt: "2026-11-11T09:15:00.000Z",
      });
      expect(
        await sessions.findValid(
          record.tokenHash,
          new Date("2026-11-11T09:15:00Z"),
        ),
      ).toBeNull();
      await sessions.revoke(id);
      expect(
        await sessions.findValid(record.tokenHash, clock.now()),
      ).toBeNull();
    });

    it("резерв атомарен, release освобождает только свою попытку, окно сбрасывается по времени", async () => {
      clock.set("2026-11-04T09:00:00Z");
      const limiter = new PostgresRateLimiter(() => sql, clock, ids);
      const key = `${prefix}:login`;
      const rules = [{ key, limit: 5, windowSec: 900 }];
      const reservations = await Promise.all(
        Array.from({ length: 10 }, () => limiter.reserve(rules)),
      );
      expect(reservations.filter(Boolean)).toHaveLength(5);
      const first = reservations.find((value) => value !== null);
      await first?.release();
      await first?.release();
      const next = await limiter.reserve(rules);
      expect(next).not.toBeNull();
      await next?.commitFailure();
      await next?.release();
      expect(await limiter.reserve(rules)).toBeNull();
      clock.advance(900_000);
      const renewed = await limiter.reserve(rules);
      expect(renewed).not.toBeNull();
      await renewed?.release();
    });

    it("10 параллельных неверных Login на PostgreSQL вызывают Argon2 verify только 5 раз", async () => {
      clock.set("2026-11-04T09:00:00Z");
      const tokens = new CryptoSessionTokens();
      const realPasswords = new Argon2PasswordHasher();
      const dummy = await realPasswords.hash("public-test-dummy");
      const verify = vi.fn((hash: string, password: string) =>
        realPasswords.verify(hash, password),
      );
      const limiter = new PostgresRateLimiter(() => sql, clock, ids);
      const login = new Login({
        users: new PostgresIdentityRepository(() => sql),
        sessions: new PostgresSessionStore(() => sql),
        tokens,
        clock,
        ids,
        passwords: { hash: (value) => realPasswords.hash(value), verify },
        logger: { info() {}, warn() {}, error() {} },
        dummyHash: async () => dummy,
        limiter: {
          reserve(rules) {
            for (const rule of rules) attemptKeys.add(rule.key);
            return limiter.reserve(rules);
          },
        },
      });
      const input = {
        login: `missing-${ids.next()}`,
        password: "wrong-test-password",
        ip: "192.0.2.98",
      };
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => login.execute(input)),
      );
      expect(verify).toHaveBeenCalledTimes(5);
      expect(
        results.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof RateLimitedError,
        ),
      ).toHaveLength(5);
      expect(
        results.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof ValidationError,
        ),
      ).toHaveLength(5);
    });

    it("БД ограничивает touch тридцатью днями и отдаёт createdAt как ISO", async () => {
      const user = await new PostgresIdentityRepository(
        () => sql,
      ).findCredentials("anna");
      if (!user) throw new Error("Нет демо-аккаунта.");
      const sessions = new PostgresSessionStore(() => sql);
      const id = ids.next();
      sessionIds.push(id);
      const hash = new CryptoSessionTokens().hash(id);
      await sessions.create({
        id,
        userId: user.userId,
        tokenHash: hash,
        createdAt: "2026-11-04T09:00:00.000Z",
        lastSeenAt: "2026-12-01T08:00:00.000Z",
        expiresAt: "2026-12-03T09:00:00.000Z",
      });
      await sessions.touch(
        id,
        new Date("2026-12-01T09:00:00Z"),
        new Date("2026-12-08T09:00:00Z"),
      );
      expect(
        await sessions.findValid(hash, new Date("2026-12-01T09:00:00Z")),
      ).toMatchObject({
        createdAt: "2026-11-04T09:00:00.000Z",
        expiresAt: "2026-12-04T09:00:00.000Z",
      });
      expect(
        await sessions.findValid(hash, new Date("2026-12-04T09:00:00Z")),
      ).toBeNull();
    });

    it("cleanup удаляет истёкшие/абсолютно старые сессии и попытки вне окна, сохраняя активные", async () => {
      const user = await new PostgresIdentityRepository(
        () => sql,
      ).findCredentials("anna");
      if (!user) throw new Error("Нет демо-аккаунта.");
      const sessions = new PostgresSessionStore(() => sql);
      const now = new Date();
      const records = [
        { id: ids.next(), age: 31 * 86_400_000, expiry: 86_400_000 },
        { id: ids.next(), age: 86_400_000, expiry: 0 },
        { id: ids.next(), age: 86_400_000, expiry: 86_400_000 },
      ];
      for (const record of records) {
        sessionIds.push(record.id);
        await sessions.create({
          id: record.id,
          userId: user.userId,
          tokenHash: new CryptoSessionTokens().hash(record.id),
          createdAt: new Date(now.getTime() - record.age).toISOString(),
          expiresAt: new Date(now.getTime() + record.expiry).toISOString(),
          lastSeenAt: now.toISOString(),
        });
      }
      const oldAttempt = ids.next();
      const activeAttempt = ids.next();
      const key = `${prefix}:cleanup`;
      await sql`insert into login_attempts (id, key, at) values (${oldAttempt}, ${key}, ${new Date(now.getTime() - 900_000).toISOString()}::timestamptz), (${activeAttempt}, ${key}, ${now.toISOString()}::timestamptz)`;
      await cleanupIdentity(sql, now);
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (!record) throw new Error("Нет тестовой записи.");
        expect(
          (await sql`select id from sessions where id = ${record.id}`).length,
        ).toBe(index === 2 ? 1 : 0);
      }
      expect(
        await sql`select id from login_attempts where key = ${key}`,
      ).toEqual([{ id: activeAttempt }]);
    });
  },
);
