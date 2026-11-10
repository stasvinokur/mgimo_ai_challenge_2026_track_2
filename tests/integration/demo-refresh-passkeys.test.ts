import { describe, expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { refreshDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)(
  "Очистка ключей и push-подписок демо-аккаунтов D-49",
  () => {
    it("удаляет только созданные больше суток назад записи seeded-пользователей всех ролей и идемпотентна", async () => {
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const clock = new FakeClock(new Date());
      const initialTime = clock.now();
      const day = 24 * 60 * 60 * 1000;
      const owners = [
        { id: ids.next(), role: "student", seeded: true },
        { id: ids.next(), role: "staff", seeded: true },
        { id: ids.next(), role: "teacher", seeded: true },
        { id: ids.next(), role: "student", seeded: false },
      ] as const;
      const records: {
        userId: string;
        passkeyId: string;
        subscriptionId: string;
        age: number;
        seeded: boolean;
      }[] = [];
      const userIds = owners.map((owner) => owner.id);
      const snapshot = async () => ({
        passkeys: [
          ...(await sql`select * from passkey_credentials
            where user_id in ${sql(userIds)} order by id`),
        ],
        subscriptions: [
          ...(await sql`select * from push_subscriptions
            where user_id in ${sql(userIds)} order by id`),
        ],
      });
      try {
        for (const owner of owners) {
          const seedKey = owner.seeded
            ? `test:refresh-identity:${owner.id}`
            : null;
          await sql`insert into users (id, login, password_hash, role, seed_key)
            values (${owner.id}, ${`refresh-identity-${owner.id}`},
              '$argon2id$test-fixture', ${owner.role}, ${seedKey})`;
          for (const age of [day + 1, day, day - 1, 60_000, -60_000]) {
            const passkeyId = ids.next();
            const subscriptionId = ids.next();
            const createdAt = new Date(
              initialTime.getTime() - age,
            ).toISOString();
            // Recent use does not renew an old key; age is based on creation.
            const lastUsedAt =
              age > day
                ? initialTime.toISOString()
                : new Date(initialTime.getTime() - 2 * day).toISOString();
            await sql`insert into passkey_credentials
              (id, user_id, credential_id, public_key, counter, transports,
                device_name, created_at, last_used_at)
              values (${passkeyId}, ${owner.id}, ${`test-${passkeyId}`},
                'dGVzdC1wdWJsaWMta2V5', 7, '{internal}', 'Учебное устройство',
                ${createdAt}::timestamptz, ${lastUsedAt}::timestamptz)`;
            await sql`insert into push_subscriptions
              (id, user_id, endpoint, p256dh, auth, failures, created_at)
              values (${subscriptionId}, ${owner.id},
                ${`https://push.example.invalid/${subscriptionId}`},
                'test-p256dh', 'test-auth', 2, ${createdAt}::timestamptz)`;
            records.push({
              userId: owner.id,
              passkeyId,
              subscriptionId,
              age,
              seeded: owner.seeded,
            });
          }
        }
        const before = await snapshot();
        expect(before.passkeys).toHaveLength(20);
        expect(before.subscriptions).toHaveLength(20);
        const expectedAfter = (elapsed: number) => {
          const expired = records.filter(
            (record) => record.seeded && record.age + elapsed > day,
          );
          return {
            passkeys: before.passkeys.filter(
              (row) => !expired.some((record) => record.passkeyId === row.id),
            ),
            subscriptions: before.subscriptions.filter(
              (row) =>
                !expired.some((record) => record.subscriptionId === row.id),
            ),
          };
        };

        await refreshDemo(sql, clock);
        expect(await snapshot()).toEqual(expectedAfter(0));
        expect((await snapshot()).passkeys).toHaveLength(17);
        await refreshDemo(sql, clock);
        expect(await snapshot()).toEqual(expectedAfter(0));

        clock.advance(2);
        await refreshDemo(sql, clock);
        expect(await snapshot()).toEqual(expectedAfter(2));
        expect((await snapshot()).passkeys).toHaveLength(11);
        expect((await snapshot()).subscriptions).toHaveLength(11);
      } finally {
        try {
          await sql`delete from users where id in ${sql(userIds)}`;
          await refreshDemo(sql, new FakeClock(initialTime));
        } finally {
          await sql.end({ timeout: 1 });
        }
      }
    }, 30_000);
  },
);
