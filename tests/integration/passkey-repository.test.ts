import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  PasskeyRecord,
  WebauthnChallenge,
} from "@/application/identity/passkey-ports";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresPasskeyRepository } from "@/infrastructure/db/repositories/identity/passkeys";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";

describe.skipIf(!process.env.DATABASE_URL)(
  "Ключи доступа на живом PostgreSQL",
  () => {
    const ids = new UuidV7Generator();
    const tokens = new CryptoSessionTokens();
    const owner = ids.next();
    const other = ids.next();
    const cappedOwner = ids.next();
    const demoOwner = ids.next();
    const racingDemoOwner = ids.next();
    const rollbackDemoOwner = ids.next();
    const demoOwners = [demoOwner, racingDemoOwner, rollbackDemoOwner];
    const allOwners = [owner, other, cappedOwner, ...demoOwners];
    const now = new Date("2026-11-05T12:00:00Z");
    let sql: ReturnType<typeof createDatabase>;
    let repository: PostgresPasskeyRepository;

    function credential(userId = owner, counter = 0): PasskeyRecord {
      const id = ids.next();
      return {
        id,
        userId,
        credentialId: `test-credential-${id}`,
        publicKey: "dGVzdC1wdWJsaWMta2V5",
        counter,
        transports: ["internal", "hybrid"],
        deviceName: "Тестовое устройство",
        createdAt: now.toISOString(),
        lastUsedAt: null,
      };
    }

    function challenge(
      purpose: WebauthnChallenge["purpose"] = "registration",
      userId: string | null = owner,
    ): WebauthnChallenge {
      const id = ids.next();
      return {
        id,
        userId,
        purpose,
        challengeHash: tokens.hash(id),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      };
    }

    beforeAll(async () => {
      sql = createDatabase(6);
      await migrate(drizzle(sql), {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle/", import.meta.url),
        ),
      });
      repository = new PostgresPasskeyRepository(() => sql);
      for (const id of allOwners) {
        await sql`
          insert into users (id, login, password_hash, role, seed_key)
          values (${id}, ${`passkey-test-${id}`}, '$argon2id$test-fixture', 'student',
            ${demoOwners.includes(id) ? `passkey-test:demo:${id}` : null})`;
      }
    }, 30_000);

    afterAll(async () => {
      if (!sql) return;
      try {
        await sql`delete from users where id in ${sql(allOwners)}`;
        await sql`delete from webauthn_challenges where user_id is null
          and challenge_hash = any(${anonymousHashes}::text[])`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    });

    const anonymousHashes: string[] = [];

    it("имя пользователя для ключа берётся из users.login текущего владельца", async () => {
      expect(await repository.findLoginForUser(owner)).toBe(
        `passkey-test-${owner}`,
      );
      expect(await repository.findLoginForUser(other)).toBe(
        `passkey-test-${other}`,
      );
      expect(await repository.findLoginForUser(ids.next())).toBeNull();
    });

    it("признак демо определяется по seed_key владельца, а не по логину", async () => {
      expect(await repository.isDemoAccount(owner)).toBe(false);
      expect(await repository.isDemoAccount(demoOwner)).toBe(true);
      expect(await repository.isDemoAccount(ids.next())).toBe(false);
    });

    async function fillDemo(userId: string) {
      const records = Array.from({ length: 10 }, (_, index) => ({
        ...credential(userId),
        createdAt: new Date(
          now.getTime() - (10 - index) * 60_000,
        ).toISOString(),
        lastUsedAt: index === 0 ? now.toISOString() : null,
      }));
      for (const record of records)
        expect(await repository.create(record)).toBe(true);
      return records;
    }

    it("новый демо-ключ вытесняет самый старый по созданию и не трогает другого владельца", async () => {
      const records = await fillDemo(demoOwner);
      const outsider = credential(other);
      expect(await repository.create(outsider)).toBe(true);
      const otherBefore = await repository.listForUser(other);
      const added = credential(demoOwner);
      expect(await repository.create(added)).toBe(true);
      const stored = await repository.listForUser(demoOwner);
      expect(stored).toHaveLength(10);
      expect(stored).toContainEqual(added);
      expect(stored.map((record) => record.id).sort()).toEqual(
        [...records.slice(1).map((record) => record.id), added.id].sort(),
      );
      expect(await repository.listForUser(other)).toEqual(otherBefore);
    });

    it("две одновременные регистрации демо-ключа проходят, вытесняя два старейших ключа", async () => {
      const records = await fillDemo(racingDemoOwner);
      const additions = [
        credential(racingDemoOwner),
        credential(racingDemoOwner),
      ];
      expect(
        await Promise.all(additions.map((record) => repository.create(record))),
      ).toEqual([true, true]);
      const stored = await repository.listForUser(racingDemoOwner);
      expect(stored).toHaveLength(10);
      expect(stored.map((record) => record.id).sort()).toEqual(
        [...records.slice(2), ...additions].map((record) => record.id).sort(),
      );
    });

    it("ошибка вставки откатывает вытеснение старого демо-ключа в той же транзакции", async () => {
      await fillDemo(rollbackDemoOwner);
      const outsider = credential(other);
      expect(await repository.create(outsider)).toBe(true);
      const before = await repository.listForUser(rollbackDemoOwner);
      await expect(
        repository.create({
          ...credential(rollbackDemoOwner),
          credentialId: outsider.credentialId,
        }),
      ).rejects.toMatchObject({ code: "23505" });
      expect(await repository.listForUser(rollbackDemoOwner)).toEqual(before);
      expect(
        await repository.findByCredentialId(outsider.credentialId),
      ).toEqual(outsider);
    });

    it("лимит 10 ключей атомарен: из 12 регистраций на последнее место проходит одна", async () => {
      for (let index = 0; index < 9; index++)
        expect(await repository.create(credential(cappedOwner))).toBe(true);
      const competing = Array.from({ length: 12 }, () =>
        credential(cappedOwner),
      );
      const created = await Promise.all(
        competing.map((record) => repository.create(record)),
      );
      expect(created.filter(Boolean)).toHaveLength(1);
      expect(created.filter((value) => !value)).toHaveLength(11);
      const stored = await repository.listForUser(cappedOwner);
      expect(stored).toHaveLength(10);
      expect(await repository.create(credential(cappedOwner))).toBe(false);
      expect(await repository.create(credential(other))).toBe(true);
      expect(
        await repository.deleteForUser(stored[0]?.id ?? "", cappedOwner),
      ).toBe(true);
      expect(await repository.create(credential(cappedOwner))).toBe(true);
      expect(await repository.listForUser(cappedOwner)).toHaveLength(10);
    });

    it("читает только свои ключи, нормализует даты и bigint без потери UInt32", async () => {
      const mine = credential(owner, 4_294_967_295);
      const theirs = credential(other);
      await repository.create(mine);
      await repository.create(theirs);
      const rows = await repository.listForUser(owner);
      expect(rows).toContainEqual(mine);
      expect(rows.some((row) => row.id === theirs.id)).toBe(false);
      expect(await repository.findByCredentialId(mine.credentialId)).toEqual(
        mine,
      );
      expect(
        await repository.findByCredentialId("missing-test-key"),
      ).toBeNull();
    });

    it("удаление чужого и отсутствующего ключа одинаково неуспешно", async () => {
      const key = credential();
      await repository.create(key);
      expect(await repository.deleteForUser(key.id, other)).toBe(false);
      expect(await repository.deleteForUser(ids.next(), other)).toBe(false);
      expect(await repository.findByCredentialId(key.credentialId)).toEqual(
        key,
      );
      expect(await repository.deleteForUser(key.id, owner)).toBe(true);
      expect(await repository.findByCredentialId(key.credentialId)).toBeNull();
      expect(await repository.updateCounter(key.id, owner, 0, 1, now)).toBe(
        false,
      );
    });

    it("демо-ключ не удаляется вручную даже напрямую через репозиторий", async () => {
      const key = credential(demoOwner);
      await repository.create(key);
      expect(await repository.deleteForUser(key.id, demoOwner)).toBe(false);
      expect(await repository.deleteForUser(ids.next(), demoOwner)).toBe(false);
      expect(await repository.findByCredentialId(key.credentialId)).toEqual(
        key,
      );
    });

    it("один credential id нельзя зарегистрировать другому владельцу", async () => {
      const key = credential();
      await repository.create(key);
      await expect(
        repository.create({ ...key, id: ids.next(), userId: other }),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("challenge потребляется ровно один раз при параллельной проверке", async () => {
      const record = challenge();
      await repository.createChallenge(record);
      expect(
        await repository.consumeChallenge(
          record.id,
          "registration",
          other,
          now,
        ),
      ).toBeNull();
      expect(
        await repository.consumeChallenge(
          record.id,
          "authentication",
          owner,
          now,
        ),
      ).toBeNull();
      const consumed = await Promise.all(
        Array.from({ length: 12 }, () =>
          repository.consumeChallenge(record.id, "registration", owner, now),
        ),
      );
      expect(consumed.filter(Boolean)).toEqual([record]);
      expect(
        await repository.consumeChallenge(
          record.id,
          "registration",
          owner,
          now,
        ),
      ).toBeNull();
      const [stored] = await sql`
        select challenge_hash, used_at from webauthn_challenges where id = ${record.id}`;
      expect(stored?.challenge_hash).toBe(tokens.hash(record.id));
      expect(stored?.used_at).toEqual(now);
    });

    it("authentication challenge требует null-владельца и точного назначения", async () => {
      const record = challenge("authentication", null);
      anonymousHashes.push(record.challengeHash);
      await repository.createChallenge(record);
      expect(
        await repository.consumeChallenge(
          record.id,
          "authentication",
          owner,
          now,
        ),
      ).toBeNull();
      expect(
        await repository.consumeChallenge(record.id, "registration", null, now),
      ).toBeNull();
      expect(
        await repository.consumeChallenge(
          record.id,
          "authentication",
          null,
          now,
        ),
      ).toEqual(record);
    });

    it("challenge не принимается до создания, на границе истечения и после неё", async () => {
      const record = challenge();
      await repository.createChallenge(record);
      for (const at of [
        new Date(now.getTime() - 1),
        new Date(record.expiresAt),
        new Date(now.getTime() + 300_001),
      ]) {
        expect(
          await repository.consumeChallenge(
            record.id,
            "registration",
            owner,
            at,
          ),
        ).toBeNull();
      }
      expect(
        await repository.consumeChallenge(
          record.id,
          "registration",
          owner,
          new Date(now.getTime() + 299_999),
        ),
      ).toEqual(record);
      await expect(
        repository.createChallenge({
          ...challenge(),
          expiresAt: new Date(now.getTime() + 300_001).toISOString(),
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("CAS счётчика пропускает одну гонку, отклоняет откат и чужого владельца", async () => {
      const key = credential(owner, 7);
      await repository.create(key);
      expect(await repository.updateCounter(key.id, other, 7, 8, now)).toBe(
        false,
      );
      expect(await repository.updateCounter(key.id, owner, 7, 6, now)).toBe(
        false,
      );
      expect(await repository.updateCounter(key.id, owner, 7, 7, now)).toBe(
        false,
      );
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          repository.updateCounter(key.id, owner, 7, 8, now),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await repository.findByCredentialId(key.credentialId)).toEqual({
        ...key,
        counter: 8,
        lastUsedAt: now.toISOString(),
      });
      expect(await repository.updateCounter(key.id, owner, 7, 9, now)).toBe(
        false,
      );
    });

    it("нулевой счётчик допускает ключ без аппаратного счётчика и обновляет последнее использование", async () => {
      const key = credential();
      await repository.create(key);
      expect(await repository.updateCounter(key.id, owner, 0, 0, now)).toBe(
        true,
      );
      expect(await repository.findByCredentialId(key.credentialId)).toEqual({
        ...key,
        lastUsedAt: now.toISOString(),
      });
    });
  },
);
