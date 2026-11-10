import type { Sql } from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  GetCalendar,
  RenewCalendarToken,
} from "@/application/schedule/calendar";
import { NotFoundError } from "@/application/shared/errors";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import {
  PostgresCalendarTokenStore,
  PostgresScheduleRepository,
} from "@/infrastructure/db/repositories/schedule/repository";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)("PostgreSQL: schedule", () => {
  const sql = createDatabase(1);
  afterAll(() => sql.end({ timeout: 1 }));

  it("чтение ограничено профилем; токены атомарно меняются только у владельца и хранятся хэшами", async () => {
    const rollback = new Error("Откат тестовой транзакции");
    await expect(
      sql.begin(async (transaction) => {
        const database = () => transaction as unknown as Sql;
        const users = new PostgresIdentityRepository(database);
        const actors = await Promise.all(
          ["anna", "timur"].map(async (login) => {
            const credentials = await users.findCredentials(login);
            const actor =
              credentials &&
              (await users.findActorByUserId(credentials.userId));
            if (actor?.kind !== "student")
              throw new Error("Выполните сид вымышленной тестовой БД.");
            return actor;
          }),
        );
        const anna = actors[0];
        const timur = actors[1];
        if (!anna || !timur) throw new Error("Нет тестовых студентов.");
        const repository = new PostgresScheduleRepository(database);
        const data = await repository.findForStudent(anna.studentId);
        const other = await repository.findForStudent(timur.studentId);
        expect(data?.slots.length).toBeGreaterThan(0);
        expect(data?.changes.some((c) => c.kind === "moved")).toBe(true);
        expect(data?.changes[0]?.createdAt).toMatch(/Z$/);
        expect(data?.group).not.toBe(other?.group);
        expect(
          data?.slots.some((slot) =>
            other?.slots.some((foreign) => foreign.id === slot.id),
          ),
        ).toBe(false);
        expect(
          await repository.findForStudent(new UuidV7Generator().next()),
        ).toBeNull();
        const store = new PostgresCalendarTokenStore(database);
        const tokens = new CryptoSessionTokens();
        const renew = new RenewCalendarToken(
          store,
          tokens,
          new UuidV7Generator(),
          repository,
        );
        const get = new GetCalendar(
          store,
          tokens,
          repository,
          new FakeClock("2026-11-04T09:00:00Z"),
        );
        const first = (await renew.execute(anna)).path.split("/").at(-1) ?? "";
        const foreign =
          (await renew.execute(timur)).path.split("/").at(-1) ?? "";
        await expect(get.execute(foreign, anna)).rejects.toBeInstanceOf(
          NotFoundError,
        );
        expect(
          (await get.execute(first)).startsWith("BEGIN:VCALENDAR\r\n"),
        ).toBe(true);
        await renew.execute(anna);
        await expect(get.execute(first)).rejects.toBeInstanceOf(NotFoundError);
        expect((await get.execute(foreign)).includes("BEGIN:VEVENT")).toBe(
          true,
        );
        const hashes = await transaction<
          { token_hash: string }[]
        >`select token_hash from calendar_tokens where student_id in (${anna.studentId}, ${timur.studentId})`;
        expect(hashes).toHaveLength(2);
        for (const row of hashes)
          expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(
          hashes.some(
            (row) => row.token_hash === first || row.token_hash === foreign,
          ),
        ).toBe(false);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
