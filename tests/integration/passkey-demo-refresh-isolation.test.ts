import type { Sql, TransactionSql } from "postgres";
import { describe, expect, it } from "vitest";
import { DEMO_PASSKEY_DEVICE_NAME } from "@/domain/identity/passkey-policy";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { withIsolatedDemoRefresh } from "./passkey-demo-refresh";

async function seededSnapshot(sql: Sql | TransactionSql) {
  return {
    schedule: [
      ...(await sql`select * from schedule_changes where seed_key is not null order by id`),
    ],
    assessments: [
      ...(await sql`select * from assessments where seed_key is not null order by id`),
    ],
    scores: [
      ...(await sql`select * from scores where seed_key is not null order by id`),
    ],
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Изолированное обновление демо-данных в тестах ключей",
  () => {
    for (const failsInspection of [false, true]) {
      it(`откатывает очистку ключей и общие seeded-данные ${failsInspection ? "при ошибке проверки" : "после успешной проверки"}`, async () => {
        const sql = createDatabase(1);
        const concurrentSql = createDatabase(1);
        const ids = new UuidV7Generator();
        const userId = ids.next();
        const oldId = ids.next();
        const freshId = ids.next();
        const clock = new FakeClock("2038-11-08T12:00:00.000Z");
        const inspectionFailure = new Error("Ожидаемая ошибка проверки");
        let inspected = false;
        try {
          await sql`insert into users (id, login, password_hash, role, seed_key)
            values (${userId}, ${`passkey-isolation-${userId}`},
              '$argon2id$test-fixture', 'student', ${`passkey-isolation:${userId}`})`;
          for (const [id, age] of [
            [oldId, 2 * 86_400_000],
            [freshId, 60_000],
          ] as const) {
            const createdAt = new Date(clock.now().getTime() - age);
            await sql`insert into passkey_credentials
              (id, user_id, credential_id, public_key, device_name, created_at)
              values (${id}, ${userId}, ${`passkey-isolation-${id}`},
                'dGVzdC1wdWJsaWMta2V5', ${DEMO_PASSKEY_DEVICE_NAME}, ${createdAt})`;
          }
          const keysBefore = [
            ...(await sql`select * from passkey_credentials where user_id = ${userId} order by id`),
          ];
          const seededBefore = await seededSnapshot(sql);
          expect(seededBefore.schedule.length).toBeGreaterThan(0);
          const refresh = withIsolatedDemoRefresh(sql, clock, async (tx) => {
            inspected = true;
            const remaining = await tx<{ id: string }[]>`
              select id from passkey_credentials where user_id = ${userId} order by id`;
            expect(remaining).toEqual([{ id: freshId }]);
            expect(await seededSnapshot(tx)).toEqual(seededBefore);
            const rollbackLocks = new Error("Откат проверки блокировок");
            try {
              await concurrentSql.begin(async (concurrent) => {
                await concurrent`set local lock_timeout = '100ms'`;
                await concurrent`select pg_advisory_xact_lock(8082026)`;
                const group = await concurrent`
                  select id from groups
                  where id = (select group_id from students where seed_key = 'demo:student:anna')
                  for update nowait`;
                expect(group).toHaveLength(1);
                const slots = await concurrent`
                  select id from schedule_slots
                  where group_id = (select group_id from students where seed_key = 'demo:student:anna')
                  for update nowait`;
                expect(slots.length).toBeGreaterThan(0);
                throw rollbackLocks;
              });
            } catch (error) {
              if (error !== rollbackLocks) throw error;
            }
            if (failsInspection) throw inspectionFailure;
          });
          if (failsInspection)
            await expect(refresh).rejects.toBe(inspectionFailure);
          else await refresh;
          expect(inspected).toBe(true);
          expect([
            ...(await sql`select * from passkey_credentials where user_id = ${userId} order by id`),
          ]).toEqual(keysBefore);
          expect(await seededSnapshot(sql)).toEqual(seededBefore);
        } finally {
          try {
            await sql`delete from users where id = ${userId}`;
          } finally {
            await sql.end({ timeout: 1 });
            await concurrentSql.end({ timeout: 1 });
          }
        }
      }, 30_000);
    }
  },
);
